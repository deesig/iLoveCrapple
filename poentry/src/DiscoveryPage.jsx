import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import bookPageSvg from './assets/bookPage.svg';

// ── Sticky-note colour palette ────────────────────────────────────────────────
const NOTE_COLORS = ['#d4f59f', '#f5d49f', '#9fd4f5', '#f59fd4', '#d49ff5', '#f5f59f'];

export default function DiscoveryPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    // ── State ───────────────────────────────────────────────────────────────────
    const [entries, setEntries] = useState([]);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [comments, setComments] = useState([]);
    const [filter, setFilter] = useState('public'); // 'public' | 'friends'
    const [search, setSearch] = useState('');
    const [newComment, setNewComment] = useState('');
    const [loading, setLoading] = useState(true);

    // ── Fetch entries ───────────────────────────────────────────────────────────
    const fetchEntries = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/entries?filter=${filter}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            setEntries(data.entries || []);
            setCurrentIdx(0);
        } catch (err) {
            console.error('Failed to load entries:', err);
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { fetchEntries(); }, [fetchEntries]);

    // ── Fetch comments for the active entry ─────────────────────────────────────
    const entry = entries[currentIdx] || null;

    useEffect(() => {
        if (!entry) { setComments([]); return; }
        fetch(`/api/entries/${entry.id}/comments`, { credentials: 'include' })
            .then(r => r.json())
            .then(d => setComments(d.comments || []))
            .catch(() => setComments([]));
    }, [entry?.id]);

    // ── Navigation ──────────────────────────────────────────────────────────────
    const prev = () => setCurrentIdx(i => Math.max(0, i - 1));
    const next = () => setCurrentIdx(i => Math.min(entries.length - 1, i + 1));

    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') prev();
            if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') next();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [entries.length]);

    // ── Actions ─────────────────────────────────────────────────────────────────
    const toggleLike = async () => {
        if (!entry) return;
        const res = await fetch(`/api/entries/${entry.id}/like`, {
            method: 'POST', credentials: 'include',
        });
        if (res.ok) {
            const { liked } = await res.json();
            setEntries(prev => prev.map((e, i) => i === currentIdx
                ? { ...e, liked, likeCount: liked ? e.likeCount + 1 : e.likeCount - 1 }
                : e
            ));
        }
    };

    const toggleBookmark = async () => {
        if (!entry) return;
        const res = await fetch(`/api/entries/${entry.id}/bookmark`, {
            method: 'POST', credentials: 'include',
        });
        if (res.ok) {
            const { bookmarked } = await res.json();
            setEntries(prev => prev.map((e, i) => i === currentIdx
                ? { ...e, bookmarked }
                : e
            ));
        }
    };

    const addComment = async () => {
        if (!entry || !newComment.trim()) return;
        const res = await fetch(`/api/entries/${entry.id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ content: newComment.trim() }),
        });
        if (res.ok) {
            const comment = await res.json();
            setComments(prev => [...prev, comment]);
            setNewComment('');
        }
    };

    const handleShare = () => {
        if (!entry) return;
        const url = `${window.location.origin}/discover?entry=${entry.id}`;
        navigator.clipboard?.writeText(url).then(() => alert('Link copied!')).catch(() => { });
    };

    // ── Format date ─────────────────────────────────────────────────────────────
    const fmtDate = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // ── Search filtering ───────────────────────────────────────────────────────
    const filteredEntries = search.trim()
        ? entries.filter(e =>
            e.title.toLowerCase().includes(search.toLowerCase()) ||
            e.username?.toLowerCase().includes(search.toLowerCase())
        )
        : entries;

    const displayEntry = search.trim() ? filteredEntries[currentIdx] : entry;

    // ── Render ──────────────────────────────────────────────────────────────────
    return (
        <div className="discovery-page">
            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <header className="disc-header">
                <h1 className="disc-logo">Poentry</h1>
                <div className="disc-header-actions">
                    <button className="disc-new-entry-btn" onClick={() => navigate('/journal')}>
                        + New Entry
                    </button>
                    <div className="disc-user-pill" onClick={() => navigate(`/profile/${user?.username}`)} style={{ cursor: 'pointer' }}>
                        {user?.avatarUrl && (
                            <img src={user.avatarUrl} alt="" className="disc-avatar" />
                        )}
                        <span className="disc-username">@{user?.username}</span>
                    </div>
                    <button className="disc-icon-btn" onClick={logout} title="Log out">⎋</button>
                    <button className="disc-icon-btn" title="Help">?</button>
                </div>
            </header>

            {/* ── Explore Controls ───────────────────────────────────────────────── */}
            <div className="disc-controls">
                <div className="disc-controls-left">
                    <span className="disc-explore-label">EXPLORE</span>
                    <div className="disc-filter-pills">
                        <button
                            className={`disc-pill ${filter === 'public' ? 'disc-pill-active' : ''}`}
                            onClick={() => setFilter('public')}
                        >
                            🌐 Public
                        </button>
                        <button
                            className={`disc-pill ${filter === 'friends' ? 'disc-pill-active' : ''}`}
                            onClick={() => setFilter('friends')}
                        >
                            👥 Friends
                        </button>
                    </div>
                </div>
                <div className="disc-search-wrapper">
                    <input
                        type="text"
                        className="disc-search-input"
                        placeholder="Search entries..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <span className="disc-search-icon">🔍</span>
                </div>
            </div>

            {/* ── Main Content ───────────────────────────────────────────────────── */}
            {loading ? (
                <div className="disc-empty-state">
                    <div className="spinner" style={{ borderTopColor: '#e8642b' }} />
                </div>
            ) : !displayEntry ? (
                <div className="disc-empty-state">
                    <div className="disc-empty-icon">📖</div>
                    <h2>No entries yet</h2>
                    <p>Be the first to publish a journal entry!</p>
                    <button className="disc-new-entry-btn" onClick={() => navigate('/journal')}>
                        + Create Your First Entry
                    </button>
                </div>
            ) : (
                <>
                    <div className="disc-main">
                        {/* ── Book Thumbnail ──────────────────────────────────────────── */}
                        <div className="disc-book-container">
                            <div className="disc-book">
                                <img src={bookPageSvg} alt="" className="disc-book-svg" />
                                {displayEntry.thumbnail ? (
                                    <img
                                        src={displayEntry.thumbnail}
                                        alt={displayEntry.title}
                                        className="disc-book-thumbnail"
                                    />
                                ) : (
                                    <div className="disc-book-blank">
                                        <span>No preview</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Entry Info + Comments (right column) ─────────────────────── */}
                        <div className="disc-info">
                            <h2 className="disc-title">{displayEntry.title}</h2>
                            <div className="disc-meta">
                                <span className="disc-date">{fmtDate(displayEntry.createdAt)}</span>
                                <span className="disc-author" onClick={() => navigate(`/profile/${displayEntry.username}`)} style={{ cursor: 'pointer' }}>{displayEntry.username || displayEntry.displayName}</span>
                            </div>
                            <p className="disc-description">
                                {displayEntry.description || 'No description provided.'}
                            </p>
                            <div className="disc-actions-row">
                                <button className="disc-read-btn" onClick={() => navigate(`/journal?view=${displayEntry.id}`)}>
                                    Read
                                </button>
                                <div className="disc-social-icons">
                                    <button
                                        className={`disc-social-btn ${displayEntry.liked ? 'disc-liked' : ''}`}
                                        onClick={toggleLike}
                                        title="Like"
                                    >
                                        {displayEntry.liked ? '❤️' : '🤍'} {displayEntry.likeCount || ''}
                                    </button>
                                    <button
                                        className={`disc-social-btn ${displayEntry.bookmarked ? 'disc-bookmarked' : ''}`}
                                        onClick={toggleBookmark}
                                        title="Bookmark"
                                    >
                                        {displayEntry.bookmarked ? '🔖' : '📑'}
                                    </button>
                                    <button className="disc-social-btn" onClick={handleShare} title="Share">
                                        🔗
                                    </button>
                                </div>
                            </div>

                            {/* ── Comments ── */}
                            <h3 className="disc-comments-label">COMMENTS</h3>
                            <div className="disc-notes-area">
                                {/* Leave a note input */}
                                <div
                                    className="disc-sticky-note disc-note-input"
                                    style={{ background: '#fff9c4', transform: 'rotate(-2deg)' }}
                                >
                                    <textarea
                                        className="disc-note-textarea"
                                        placeholder="Leave a note..."
                                        value={newComment}
                                        onChange={e => setNewComment(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); } }}
                                    />
                                    <button className="disc-note-send" onClick={addComment}>↵</button>
                                </div>

                                {/* Existing sticky notes */}
                                {comments.map((c) => (
                                    <div
                                        key={c.id}
                                        className="disc-sticky-note"
                                        style={{
                                            background: c.color || '#d4f59f',
                                            transform: `rotate(${c.rotation || 0}deg)`,
                                        }}
                                    >
                                        <p className="disc-note-content">{c.content}</p>
                                        <span className="disc-note-author">— {c.username || 'anon'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ── Navigation Arrows ─────────────────────────────────────────── */}
                    <div className="disc-nav">
                        <button
                            className="disc-nav-btn disc-nav-prev"
                            onClick={prev}
                            disabled={currentIdx === 0}
                        >
                            ← <span className="disc-nav-key">[A]</span>
                        </button>
                        <button
                            className="disc-nav-btn disc-nav-next"
                            onClick={next}
                            disabled={currentIdx >= entries.length - 1}
                        >
                            <span className="disc-nav-key">[D]</span> →
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
