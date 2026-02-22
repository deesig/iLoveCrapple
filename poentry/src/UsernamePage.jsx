import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import poentryBG from './assets/iconography/3x/poentryBG.png';
import poentryLogo from './assets/iconography/poentrylogo.svg';
import chooseUser from './assets/3x/chooseUser.png';
import flowerGrad from './assets/3x/flowerGrad.png';

export default function UsernamePage() {
    const { user, loading, setUsername: saveUsername } = useAuth();
    const navigate = useNavigate();

    const [username, setUsername] = useState('');
    const [status, setStatus] = useState({ checking: false, available: null, reason: null });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const debounceRef = useRef(null);

    // Redirect unauthenticated users
    useEffect(() => {
        if (!loading && !user) navigate('/', { replace: true });
        if (!loading && user?.username) navigate('/discover', { replace: true });
    }, [user, loading, navigate]);

    // Debounced availability check
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        const trimmed = username.trim();
        if (trimmed.length < 3) {
            setStatus({ checking: false, available: null, reason: trimmed.length > 0 ? 'Must be at least 3 characters' : null });
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setStatus({ checking: false, available: false, reason: 'Only letters, numbers, and underscores' });
            return;
        }

        if (trimmed.length > 20) {
            setStatus({ checking: false, available: false, reason: 'Maximum 20 characters' });
            return;
        }

        setStatus({ checking: true, available: null, reason: null });

        debounceRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/username/check?username=${encodeURIComponent(trimmed)}`, {
                    credentials: 'include',
                });
                const data = await res.json();
                setStatus({ checking: false, available: data.available, reason: data.reason });
            } catch {
                setStatus({ checking: false, available: null, reason: 'Could not check availability' });
            }
        }, 400);

        return () => clearTimeout(debounceRef.current);
    }, [username]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await saveUsername(username.trim());
            navigate('/discover', { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="page-loading">
                <div className="spinner" />
            </div>
        );
    }

    const canSubmit = status.available && !status.checking && !submitting;

    return (
        <div className="username-page">
            <img src={poentryLogo} alt="Poentry Logo" className="main-logo" />
            <img src={poentryBG} alt="Poentry Background" className="login-bg-image" />
            <div className="flower-box">
                <img src={chooseUser} alt="Choose Username" className="choose-user-image" />
                <img src={flowerGrad} alt="Decoration" className="flower-grad-image" />
            </div>
            

            <div className="username-card">
                
                <h1 className="login-title">Choose a Username</h1>
                <p className="login-subtitle">This will be your unique identity on Poentry</p>
                

                <form onSubmit={handleSubmit} className="username-form">
                    <div className="username-input-wrapper">
                        <span className="username-prefix">@</span>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase())}
                            placeholder="your_username"
                            maxLength={20}
                            autoFocus
                            className="username-input"
                        />
                        <div className="username-status">
                            {status.checking && <span className="status-checking">⏳</span>}
                            {!status.checking && status.available === true && <span className="status-available">✅</span>}
                            {!status.checking && status.available === false && <span className="status-taken">❌</span>}
                        </div>
                    </div>

                    {status.reason && (
                        <p className={`username-hint ${status.available ? 'hint-ok' : 'hint-error'}`}>
                            {status.reason}
                        </p>
                    )}

                    {error && <p className="username-hint hint-error">{error}</p>}

                    <button type="submit" disabled={!canSubmit} className="username-submit">
                        {submitting ? 'Setting up...' : 'Continue to Poentry →'}
                    </button>
                </form>
            </div>
        </div>
    );
}
