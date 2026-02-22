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

  CREATE TABLE IF NOT EXISTS user_audio (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    audio_data TEXT NOT NULL,
    filename   TEXT DEFAULT 'audio.mp3',
    mime_type  TEXT DEFAULT 'audio/mpeg',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS published_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL DEFAULT 'Untitled',
    description TEXT DEFAULT '',
    thumbnail   TEXT,
    canvas_json TEXT NOT NULL,
    visibility  TEXT DEFAULT 'public',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entry_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id   INTEGER NOT NULL REFERENCES published_entries(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT NOT NULL,
    color      TEXT DEFAULT '#d4f59f',
    pos_x      REAL DEFAULT 0,
    pos_y      REAL DEFAULT 0,
    rotation   REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entry_likes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES published_entries(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    UNIQUE(entry_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS entry_bookmarks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES published_entries(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    UNIQUE(entry_id, user_id)
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

    // Audio statements
    insertAudio: db.prepare(
        'INSERT INTO user_audio (user_id, audio_data, filename, mime_type) VALUES (?, ?, ?, ?)'
    ),
    getUserAudioFiles: db.prepare(
        'SELECT id, filename, mime_type, created_at FROM user_audio WHERE user_id = ? ORDER BY created_at DESC'
    ),
    getAudioById: db.prepare('SELECT * FROM user_audio WHERE id = ? AND user_id = ?'),
    deleteAudio: db.prepare('DELETE FROM user_audio WHERE id = ? AND user_id = ?'),

    // Published entries statements
    insertEntry: db.prepare(
        'INSERT INTO published_entries (user_id, title, description, thumbnail, canvas_json, visibility) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    getPublicEntries: db.prepare(`
        SELECT pe.*, u.username, u.display_name, u.avatar_url,
               (SELECT COUNT(*) FROM entry_likes WHERE entry_id = pe.id) AS like_count,
               (SELECT COUNT(*) FROM entry_comments WHERE entry_id = pe.id) AS comment_count
        FROM published_entries pe
        JOIN users u ON pe.user_id = u.id
        WHERE pe.visibility = 'public'
        ORDER BY pe.created_at DESC
        LIMIT ? OFFSET ?
    `),
    getEntryById: db.prepare(`
        SELECT pe.*, u.username, u.display_name, u.avatar_url,
               (SELECT COUNT(*) FROM entry_likes WHERE entry_id = pe.id) AS like_count,
               (SELECT COUNT(*) FROM entry_comments WHERE entry_id = pe.id) AS comment_count
        FROM published_entries pe
        JOIN users u ON pe.user_id = u.id
        WHERE pe.id = ?
    `),
    getEntryComments: db.prepare(`
        SELECT ec.*, u.username, u.display_name, u.avatar_url
        FROM entry_comments ec
        JOIN users u ON ec.user_id = u.id
        WHERE ec.entry_id = ?
        ORDER BY ec.created_at ASC
    `),
    insertComment: db.prepare(
        'INSERT INTO entry_comments (entry_id, user_id, content, color, pos_x, pos_y, rotation) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    findLike: db.prepare('SELECT id FROM entry_likes WHERE entry_id = ? AND user_id = ?'),
    insertLike: db.prepare('INSERT INTO entry_likes (entry_id, user_id) VALUES (?, ?)'),
    deleteLike: db.prepare('DELETE FROM entry_likes WHERE entry_id = ? AND user_id = ?'),
    findBookmark: db.prepare('SELECT id FROM entry_bookmarks WHERE entry_id = ? AND user_id = ?'),
    insertBookmark: db.prepare('INSERT INTO entry_bookmarks (entry_id, user_id) VALUES (?, ?)'),
    deleteBookmark: db.prepare('DELETE FROM entry_bookmarks WHERE entry_id = ? AND user_id = ?'),
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

// ── Audio ──────────────────────────────────────────────────────────────────────
app.post('/api/audio', requireAuth, (req, res) => {
    const { audioData, filename, mimeType } = req.body;
    if (!audioData) return res.status(400).json({ error: 'Missing audioData' });

    try {
        const info = stmts.insertAudio.run(
            req.session.userId,
            audioData,
            filename || 'audio.mp3',
            mimeType || 'audio/mpeg'
        );
        res.json({
            id: info.lastInsertRowid,
            filename: filename || 'audio.mp3',
            mimeType: mimeType || 'audio/mpeg',
        });
    } catch (err) {
        console.error('Audio upload error:', err);
        res.status(500).json({ error: 'Failed to save audio' });
    }
});

app.get('/api/audio', requireAuth, (req, res) => {
    const audioFiles = stmts.getUserAudioFiles.all(req.session.userId);
    res.json({ audioFiles });
});

app.get('/api/audio/:id', requireAuth, (req, res) => {
    const audio = stmts.getAudioById.get(req.params.id, req.session.userId);
    if (!audio) return res.status(404).json({ error: 'Audio not found' });
    res.json({ audioData: audio.audio_data, mimeType: audio.mime_type });
});

app.delete('/api/audio/:id', requireAuth, (req, res) => {
    const result = stmts.deleteAudio.run(req.params.id, req.session.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Audio not found' });
    res.json({ ok: true });
});

// ── Published Entries (Discovery) ─────────────────────────────────────────────
app.post('/api/entries/publish', requireAuth, (req, res) => {
    const { title, description, thumbnail, canvasJSON, visibility } = req.body;
    if (!canvasJSON) return res.status(400).json({ error: 'Missing canvasJSON' });

    try {
        const info = stmts.insertEntry.run(
            req.session.userId,
            title || 'Untitled',
            description || '',
            thumbnail || null,
            typeof canvasJSON === 'string' ? canvasJSON : JSON.stringify(canvasJSON),
            visibility || 'public'
        );
        res.json({ id: info.lastInsertRowid, ok: true });
    } catch (err) {
        console.error('Publish error:', err);
        res.status(500).json({ error: 'Failed to publish entry' });
    }
});

app.get('/api/entries', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const entries = stmts.getPublicEntries.all(limit, offset);
        // Check like/bookmark status for the current user
        const enriched = entries.map(e => ({
            id: e.id,
            userId: e.user_id,
            title: e.title,
            description: e.description,
            thumbnail: e.thumbnail,
            visibility: e.visibility,
            createdAt: e.created_at,
            username: e.username,
            displayName: e.display_name,
            avatarUrl: e.avatar_url,
            likeCount: e.like_count,
            commentCount: e.comment_count,
            liked: !!stmts.findLike.get(e.id, req.session.userId),
            bookmarked: !!stmts.findBookmark.get(e.id, req.session.userId),
        }));
        res.json({ entries: enriched });
    } catch (err) {
        console.error('List entries error:', err);
        res.status(500).json({ error: 'Failed to list entries' });
    }
});

app.get('/api/entries/:id', requireAuth, (req, res) => {
    const entry = stmts.getEntryById.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    res.json({
        id: entry.id,
        userId: entry.user_id,
        title: entry.title,
        description: entry.description,
        thumbnail: entry.thumbnail,
        canvasJSON: entry.canvas_json,
        visibility: entry.visibility,
        createdAt: entry.created_at,
        username: entry.username,
        displayName: entry.display_name,
        avatarUrl: entry.avatar_url,
        likeCount: entry.like_count,
        commentCount: entry.comment_count,
        liked: !!stmts.findLike.get(entry.id, req.session.userId),
        bookmarked: !!stmts.findBookmark.get(entry.id, req.session.userId),
    });
});

app.get('/api/entries/:id/comments', requireAuth, (req, res) => {
    const comments = stmts.getEntryComments.all(req.params.id);
    res.json({
        comments: comments.map(c => ({
            id: c.id,
            content: c.content,
            color: c.color,
            posX: c.pos_x,
            posY: c.pos_y,
            rotation: c.rotation,
            createdAt: c.created_at,
            username: c.username,
            displayName: c.display_name,
            avatarUrl: c.avatar_url,
        })),
    });
});

app.post('/api/entries/:id/comments', requireAuth, (req, res) => {
    const { content, color, posX, posY, rotation } = req.body;
    if (!content) return res.status(400).json({ error: 'Missing content' });

    const COLORS = ['#d4f59f', '#f5d49f', '#9fd4f5', '#f59fd4', '#d49ff5', '#f5f59f'];
    const noteColor = color || COLORS[Math.floor(Math.random() * COLORS.length)];
    const noteRotation = rotation ?? (Math.random() * 12 - 6); // -6° to +6°
    const noteX = posX ?? (Math.random() * 300);
    const noteY = posY ?? (Math.random() * 150);

    try {
        const info = stmts.insertComment.run(
            req.params.id,
            req.session.userId,
            content,
            noteColor,
            noteX,
            noteY,
            noteRotation
        );
        const user = stmts.findUserById.get(req.session.userId);
        res.json({
            id: info.lastInsertRowid,
            content,
            color: noteColor,
            posX: noteX,
            posY: noteY,
            rotation: noteRotation,
            username: user.username,
            displayName: user.display_name,
        });
    } catch (err) {
        console.error('Comment error:', err);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

app.post('/api/entries/:id/like', requireAuth, (req, res) => {
    const existing = stmts.findLike.get(req.params.id, req.session.userId);
    if (existing) {
        stmts.deleteLike.run(req.params.id, req.session.userId);
        res.json({ liked: false });
    } else {
        try {
            stmts.insertLike.run(req.params.id, req.session.userId);
            res.json({ liked: true });
        } catch (err) {
            res.json({ liked: false });
        }
    }
});

app.post('/api/entries/:id/bookmark', requireAuth, (req, res) => {
    const existing = stmts.findBookmark.get(req.params.id, req.session.userId);
    if (existing) {
        stmts.deleteBookmark.run(req.params.id, req.session.userId);
        res.json({ bookmarked: false });
    } else {
        try {
            stmts.insertBookmark.run(req.params.id, req.session.userId);
            res.json({ bookmarked: true });
        } catch (err) {
            res.json({ bookmarked: false });
        }
    }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Poentry API server running on http://localhost:${PORT}`);
});
