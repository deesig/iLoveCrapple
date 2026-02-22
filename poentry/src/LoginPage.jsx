import React, { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import poentryLanding from './assets/iconography/3x/poentryLanding.png';
import poentryLogo from './assets/iconography/poentrylogo.svg';
import poentryBG from './assets/iconography/3x/poentryBG.png';

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
            
            <img src={poentryLogo} alt="Poentry Logo" className="main-logo" />
            <div className="login-bg">
                <img src={poentryBG} alt="Poentry Background" className="login-bg-image" />
                
            </div>
            <img src={poentryLanding} alt="Poentry Logo" className="login-logo" />

            
            <div ref={googleBtnRef} className="google-btn-wrapper" />
                
        </div>
    );
}
