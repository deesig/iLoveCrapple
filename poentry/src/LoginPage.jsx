import React, { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';

export default function LoginPage() {
    const { user, loading, login } = useAuth();
    const navigate = useNavigate();
    const googleBtnRef = useRef(null);

    // Redirect if already logged in
    useEffect(() => {
        if (!loading && user) {
            navigate(user.username ? '/journal' : '/username', { replace: true });
        }
    }, [user, loading, navigate]);

    const handleCredentialResponse = useCallback(
        async (response) => {
            try {
                const data = await login(response.credential);
                navigate(data.username ? '/journal' : '/username', { replace: true });
            } catch (err) {
                console.error('Login error:', err);
            }
        },
        [login, navigate]
    );

    // Initialize Google Sign-In button
    useEffect(() => {
        if (loading || user) return;

        const initGoogle = () => {
            if (!window.google?.accounts?.id) {
                setTimeout(initGoogle, 200);
                return;
            }
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse,
            });
            if (googleBtnRef.current) {
                window.google.accounts.id.renderButton(googleBtnRef.current, {
                    theme: 'filled_black',
                    size: 'large',
                    shape: 'pill',
                    text: 'continue_with',
                    width: 300,
                });
            }
        };
        initGoogle();
    }, [loading, user, handleCredentialResponse]);

    if (loading) {
        return (
            <div className="page-loading">
                <div className="spinner" />
            </div>
        );
    }

    return (
        <div className="login-page">
            {/* Animated background blobs */}
            <div className="login-bg">
                <div className="blob blob-1" />
                <div className="blob blob-2" />
                <div className="blob blob-3" />
            </div>

            <div className="login-card">
                <div className="login-icon">✍️</div>
                <h1 className="login-title">Poentry</h1>
                <p className="login-subtitle">Your Digital Journal</p>
                <p className="login-description">
                    A beautiful canvas where your thoughts flow freely.<br />
                    Create, format, and organize your writing in your own private space.
                </p>
                <div className="login-divider" />
                <div ref={googleBtnRef} className="google-btn-wrapper" />
                <p className="login-footer">Your data stays private and secure.</p>
            </div>
        </div>
    );
}
