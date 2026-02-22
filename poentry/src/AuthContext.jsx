import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Check for existing session on mount
    useEffect(() => {
        fetch('/api/auth/me', { credentials: 'include' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => setUser(data))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const login = useCallback(async (credential) => {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ credential }),
        });
        if (!res.ok) throw new Error('Login failed');
        const data = await res.json();
        setUser(data);
        return data;
    }, []);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
    }, []);

    const setUsername = useCallback(async (username) => {
        const res = await fetch('/api/username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to set username');
        }
        const data = await res.json();
        setUser((prev) => ({ ...prev, username: data.username }));
        return data;
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, setUsername }}>
            {children}
        </AuthContext.Provider>
    );
}
