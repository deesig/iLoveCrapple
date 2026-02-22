import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import bookPageSvg from './assets/bookPage.svg';

export default function ProfilePage() {
    const { username } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const bannerInputRef = useRef(null);
    const avatarInputRef = useRef(null);

    // ── State ───────────────────────────────────────────────────────────────────
    const [profile, setProfile] = useState(null);
    const [entries, setEntries] = useState([]);
    const [pinned, setPinned] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [bio, setBio] = useState('');
    const [bannerUrl, setBannerUrl] = useState('');
    const [customAvatar, setCustomAvatar] = useState('');
    const [tab, setTab] = useState('pages'); // 'pages' | 'journals'

    // ── Fetch profile data ──────────────────────────────────────────────────────
    const fetchProfile = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/profile/${username}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            setProfile(data.profile);
            setEntries(data.entries);
            setPinned(data.pinned);
            setBio(data.profile.bio || '');
            setBannerUrl(data.profile.banner_url || '');
            setCustomAvatar(data.profile.custom_avatar || '');
        } catch (err) {
            console.error('Failed to load profile:', err);
        } finally {
            setLoading(false);
        }
    }, [username]);

    useEffect(() => { fetchProfile(); }, [fetchProfile]);

    // ── Actions ─────────────────────────────────────────────────────────────────
    const pinEntry = async (entryId) => {
        const res = await fetch(`/api/profile/pin/${entryId}`, {
            method: 'POST', credentials: 'include',
        });
        if (res.ok) fetchProfile();
        else {
            const data = await res.json();
            alert(data.error || 'Failed to pin');
        }
    };

    const unpinEntry = async (entryId) => {
        const res = await fetch(`/api/profile/pin/${entryId}`, {
            method: 'DELETE', credentials: 'include',
        });
        if (res.ok) fetchProfile();
    };

    const saveBio = async () => {
        await fetch('/api/profile/bio', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ bio }),
        });
    };

    const saveBanner = async (dataUrl) => {
        await fetch('/api/profile/banner', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ bannerUrl: dataUrl }),
        });
        setBannerUrl(dataUrl);
    };

    const handleBannerUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            saveBanner(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const removeBanner = () => {
        saveBanner('');
    };

    const saveCustomAvatar = async (dataUrl) => {
        await fetch('/api/profile/avatar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ avatarUrl: dataUrl }),
        });
        setCustomAvatar(dataUrl);
    };

    const handleAvatarUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            saveCustomAvatar(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const removeCustomAvatar = () => {
        saveCustomAvatar('');
    };

    const toggleEditing = () => {
        if (editing) {
            saveBio();
        }
        setEditing(!editing);
    };

    // ── Helpers ──────────────────────────────────────────────────────────────────
    const fmtDate = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const isPinned = (entryId) => pinned.some(p => p.id === entryId);

    if (loading) {
        return (
            <div className="profile-page">
                <div className="disc-empty-state">
                    <div className="spinner" style={{ borderTopColor: '#e8642b' }} />
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="profile-page">
                <div className="disc-empty-state">
                    <h2>User not found</h2>
                    <button className="disc-new-entry-btn" onClick={() => navigate('/discover')}>
                        ← Back to Explore
                    </button>
                </div>
            </div>
        );
    }

    // ── Render ──────────────────────────────────────────────────────────────────
    return (
        <div
            className="profile-page"
            style={bannerUrl ? {
                backgroundImage: `url(${bannerUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundAttachment: 'fixed',
            } : {}}
        >
            {/* hidden file input for banner */}
            <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleBannerUpload}
            />
            <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
            />

            {/* ── Header ────────────────────────────────────────────────────────── */}
            <header className="disc-header prof-header-transparent">
                <h1 className="disc-logo">Poentry</h1>
                <div className="disc-header-actions">
                    <button className="disc-new-entry-btn" onClick={() => navigate('/journal')}>
                        + New Entry
                    </button>
                    <div className="disc-user-pill" onClick={() => navigate(`/profile/${user?.username}`)} style={{ cursor: 'pointer' }}>
                        {user?.avatarUrl && <img src={user.avatarUrl} alt="" className="disc-avatar" />}
                        <span className="disc-username">@{user?.username}</span>
                    </div>
                    <button className="disc-icon-btn" title="Help">?</button>
                </div>
            </header>

            {/* ── Main Panel ─────────────────────────────────────────────────────── */}
            <div className="prof-panel">
                {/* ── Back to Explore ─────────────────────────────────────────── */}
                <div className="prof-back-row">
                    <Link to="/discover" className="prof-back-link">
                        ← <span>Explore</span>
                    </Link>
                    {editing && (
                        <div className="prof-banner-controls">
                            <button className="prof-banner-btn" onClick={() => bannerInputRef.current?.click()}>
                                🖼️ {bannerUrl ? 'Change Background' : 'Set Background'}
                            </button>
                            {bannerUrl && (
                                <button className="prof-banner-btn prof-banner-remove" onClick={removeBanner}>
                                    ✕ Remove
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Profile Content ────────────────────────────────────────── */}
                <div className="prof-content">
                    {/* ── Left Column: Profile Info ──────────────────────────── */}
                    <div className="prof-left">
                        <span className="prof-section-label">PROFILE</span>

                        <div className="prof-avatar-box">
                            {(customAvatar || profile.avatar_url) ? (
                                <img src={customAvatar || profile.avatar_url} alt={profile.username} className="prof-avatar-img" />
                            ) : (
                                <div className="prof-avatar-placeholder" />
                            )}
                            {editing && (
                                <div className="prof-avatar-overlay" onClick={() => avatarInputRef.current?.click()}>
                                    📷
                                </div>
                            )}
                        </div>
                        {editing && customAvatar && (
                            <button className="prof-avatar-reset" onClick={removeCustomAvatar}>
                                ↩ Reset to Google avatar
                            </button>
                        )}

                        {!profile.isOwn && (
                            <button className="prof-follow-btn">
                                Follow
                            </button>
                        )}

                        {profile.isOwn && (
                            <button
                                className={`prof-edit-btn ${editing ? 'prof-edit-active' : ''}`}
                                onClick={toggleEditing}
                            >
                                {editing ? '✓ Done Editing' : '✏️ Edit Profile'}
                            </button>
                        )}

                        <h2 className="prof-username">{profile.username}</h2>

                        {editing ? (
                            <textarea
                                className="prof-bio-edit"
                                value={bio}
                                onChange={e => setBio(e.target.value)}
                                placeholder="Write a short bio..."
                                maxLength={500}
                            />
                        ) : (
                            <p className="prof-bio">{profile.bio || 'No bio yet.'}</p>
                        )}
                    </div>

                    {/* ── Right Column: Pinned + Entries ─────────────────────── */}
                    <div className="prof-right">
                        {/* ── Pinned Section ─────────────────────────────────── */}
                        <div className="prof-pinned-section">
                            <div className="prof-pinned-header">
                                <span className="prof-section-label">PINNED ENTRIES</span>
                                {editing && pinned.length < 3 && (
                                    <span className="prof-add-pin-hint">Add Pin</span>
                                )}
                            </div>
                            <div className="prof-pinned-grid">
                                {pinned.map(p => (
                                    <div
                                        key={p.id}
                                        className="prof-pinned-card"
                                        onClick={() => navigate(`/discover?entry=${p.id}`)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <div className="prof-pinned-book">
                                            <img src={bookPageSvg} alt="" className="prof-pinned-svg" />
                                            {p.thumbnail && (
                                                <img
                                                    src={p.thumbnail}
                                                    alt={p.title}
                                                    className="prof-pinned-thumb"
                                                />
                                            )}
                                        </div>
                                        <div className="prof-pin-icon">📌</div>
                                        {editing && (
                                            <button
                                                className="prof-pin-remove"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    unpinEntry(p.id);
                                                }}
                                                title="Remove pin"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {pinned.length === 0 && (
                                    <p className="prof-no-pins">No pinned entries yet.</p>
                                )}
                            </div>
                        </div>

                        {/* ── Tabs ───────────────────────────────────────────── */}
                        <div className="prof-tabs">
                            <button
                                className={`prof-tab ${tab === 'pages' ? 'prof-tab-active' : ''}`}
                                onClick={() => setTab('pages')}
                            >
                                📄 PAGES
                            </button>
                            <button
                                className={`prof-tab ${tab === 'journals' ? 'prof-tab-active' : ''}`}
                                onClick={() => setTab('journals')}
                            >
                                📓 JOURNALS
                            </button>
                        </div>

                        {/* ── Entry Grid ─────────────────────────────────────── */}
                        <div className="prof-entry-grid">
                            {entries.length === 0 ? (
                                <p className="prof-no-entries">No entries yet.</p>
                            ) : (
                                entries.map(e => (
                                    <div key={e.id} className="prof-entry-card" onClick={() => navigate(`/discover?entry=${e.id}`)}>
                                        <div className="prof-entry-book">
                                            <img src={bookPageSvg} alt="" className="prof-entry-svg" />
                                            {e.thumbnail && (
                                                <img
                                                    src={e.thumbnail}
                                                    alt={e.title}
                                                    className="prof-entry-thumb"
                                                />
                                            )}
                                        </div>
                                        {editing && !isPinned(e.id) && pinned.length < 3 && (
                                            <button
                                                className="prof-pin-add"
                                                onClick={(ev) => { ev.stopPropagation(); pinEntry(e.id); }}
                                                title="Pin this entry"
                                            >
                                                📌+
                                            </button>
                                        )}
                                        {editing && isPinned(e.id) && (
                                            <span className="prof-pin-badge">📌</span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}
