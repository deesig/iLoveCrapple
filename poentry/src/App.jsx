import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './LoginPage';
import UsernamePage from './UsernamePage';
import DigitalJournal from './DigitalJournal';
import DiscoveryPage from './DiscoveryPage';
import ProfilePage from './ProfilePage';

// Protected route: requires authentication
function ProtectedRoute({ children, requireUsername = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;
  if (requireUsername && !user.username) return <Navigate to="/username" replace />;

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/username"
        element={
          <ProtectedRoute>
            <UsernamePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/discover"
        element={
          <ProtectedRoute requireUsername>
            <DiscoveryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/journal"
        element={
          <ProtectedRoute requireUsername>
            <DigitalJournal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile/:username"
        element={
          <ProtectedRoute requireUsername>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;