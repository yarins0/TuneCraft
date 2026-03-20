import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import PlaylistDetail from './pages/PlaylistDetail.tsx';
import PrivacyPolicy from './pages/PrivacyPolicy';

// Checks if a userId exists in session storage.
// Used to protect routes that require authentication.
const isAuthenticated = () => !!localStorage.getItem('userId');

// ProtectedRoute wraps any page that requires the user to be logged in.
// If the user is not authenticated, they are redirected to the login page.
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/" />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/playlist/:playlistId"
          element={
            <ProtectedRoute>
              <PlaylistDetail />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

        /*<Route path="/contact" element={<Contact />} />*/
