import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import cors from 'cors';
import Database from 'better-sqlite3';
import { OAuth2Client } from 'google-auth-library';

// ── Configuration ──────────────────────────────────────────────────────────────
const PORT = 3001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const SESSION_SECRET = process.env.SESSION_SECRET || 'poentry-dev-secret-change-in-production';

// ── Database setup ─────────────────────────────────────────────────────────────
const db = new Database('./poentry.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id    TEXT UNIQUE NOT NULL,
    username     TEXT UNIQUE,
    display_name TEXT,
    avatar_url   TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS canvases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
    canvas_json TEXT NOT NULL DEFAULT '{}',
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    image_data TEXT NOT NULL,
    thumbnail  TEXT NOT NULL,
    filename   TEXT DEFAULT 'pasted-image',
    mime_type  TEXT DEFAULT 'image/png',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Prepared statements ────────────────────────────────────────────────────────
const stmts = {
    findUserByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
    insertUser: db.prepare(
        'INSERT INTO users (google_id, display_name, avatar_url) VALUES (?, ?, ?)'
    ),
    updateUser: db.prepare(
        'UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?'
    ),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findUserByUsername: db.prepare('SELECT id FROM users WHERE username = ?'),
    setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
    getCanvas: db.prepare('SELECT canvas_json, updated_at FROM canvases WHERE user_id = ?'),
    upsertCanvas: db.prepare(`
    INSERT INTO canvases (user_id, canvas_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET canvas_json = excluded.canvas_json, updated_at = datetime('now')
  `),
    // Image statements
    insertImage: db.prepare(
        'INSERT INTO user_images (user_id, image_data, thumbnail, filename, mime_type) VALUES (?, ?, ?, ?, ?)'
    ),
    getUserImages: db.prepare(
        'SELECT id, thumbnail, filename, mime_type, created_at FROM user_images WHERE user_id = ? ORDER BY created_at DESC'
    ),
    getImageById: db.prepare('SELECT * FROM user_images WHERE id = ? AND user_id = ?'),
    deleteImage: db.prepare('DELETE FROM user_images WHERE id = ? AND user_id = ?'),
};

// ── Express app ────────────────────────────────────────────────────────────────
const app = express();
const SQLiteStore = connectSqlite3(session);

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
}));
app.use(express.json({ limit: '50mb' })); // canvas JSON with embedded images can be large

app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: '.' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // set true in production with HTTPS
    },
}));

// ── Auth middleware ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    next();
}

// ── Google OAuth ───────────────────────────────────────────────────────────────
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: googleId, name, picture } = payload;

        // Upsert user
        let user = stmts.findUserByGoogleId.get(googleId);
        if (!user) {
            const info = stmts.insertUser.run(googleId, name, picture);
            user = stmts.findUserById.get(info.lastInsertRowid);
        } else {
            stmts.updateUser.run(name, picture, user.id);
            user = stmts.findUserById.get(user.id);
        }

        req.session.userId = user.id;
        res.json({
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
        });
    } catch (err) {
        console.error('Google auth error:', err);
        res.status(401).json({ error: 'Invalid credential' });
    }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = stmts.findUserById.get(req.session.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// ── Username ───────────────────────────────────────────────────────────────────
app.get('/api/username/check', requireAuth, (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const valid = /^[a-zA-Z0-9_]{3,20}$/.test(username);
    if (!valid) return res.json({ available: false, reason: 'Must be 3-20 alphanumeric characters or underscores' });

    const existing = stmts.findUserByUsername.get(username.toLowerCase());
    res.json({ available: !existing, reason: existing ? 'Username already taken' : null });
});

app.post('/api/username', requireAuth, (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const valid = /^[a-zA-Z0-9_]{3,20}$/.test(username);
    if (!valid) return res.status(400).json({ error: 'Must be 3-20 alphanumeric characters or underscores' });

    // Check current user doesn't already have a username
    const user = stmts.findUserById.get(req.session.userId);
    if (user.username) return res.status(400).json({ error: 'Username already set' });

    // Check uniqueness (case-insensitive)
    const existing = stmts.findUserByUsername.get(username.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    try {
        stmts.setUsername.run(username.toLowerCase(), req.session.userId);
        res.json({ username: username.toLowerCase() });
    } catch (err) {
        res.status(409).json({ error: 'Username already taken' });
    }
});

// ── Canvas persistence ─────────────────────────────────────────────────────────
app.get('/api/canvas', requireAuth, (req, res) => {
    const row = stmts.getCanvas.get(req.session.userId);
    if (!row) return res.json({ canvasJSON: null });
    res.json({ canvasJSON: JSON.parse(row.canvas_json), updatedAt: row.updated_at });
});

app.put('/api/canvas', requireAuth, (req, res) => {
    const { canvasJSON } = req.body;
    if (!canvasJSON) return res.status(400).json({ error: 'Missing canvasJSON' });

    stmts.upsertCanvas.run(req.session.userId, JSON.stringify(canvasJSON));
    res.json({ ok: true });
});

// ── Images ─────────────────────────────────────────────────────────────────────
app.post('/api/images', requireAuth, (req, res) => {
    const { imageData, filename, mimeType } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    // Generate a small thumbnail (we store the data URL as-is for the thumbnail;
    // the client sends a pre-generated thumbnail alongside the full image)
    const thumbnail = req.body.thumbnail || imageData;

    try {
        const info = stmts.insertImage.run(
            req.session.userId,
            imageData,
            thumbnail,
            filename || 'pasted-image',
            mimeType || 'image/png'
        );
        res.json({
            id: info.lastInsertRowid,
            thumbnail,
            filename: filename || 'pasted-image',
            mimeType: mimeType || 'image/png',
        });
    } catch (err) {
        console.error('Image upload error:', err);
        res.status(500).json({ error: 'Failed to save image' });
    }
});

app.get('/api/images', requireAuth, (req, res) => {
    const images = stmts.getUserImages.all(req.session.userId);
    res.json({ images });
});

app.get('/api/images/:id', requireAuth, (req, res) => {
    const image = stmts.getImageById.get(req.params.id, req.session.userId);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.json({ imageData: image.image_data, mimeType: image.mime_type });
});

app.delete('/api/images/:id', requireAuth, (req, res) => {
    const result = stmts.deleteImage.run(req.params.id, req.session.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Image not found' });
    res.json({ ok: true });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Poentry API server running on http://localhost:${PORT}`);
});
