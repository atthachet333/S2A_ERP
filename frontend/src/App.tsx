import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PasswordRoute } from '@/auth/RouteGuards';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import DashboardPage from '@/pages/DashboardPage';
import ProfilePage from '@/pages/ProfilePage';
import UsersPage, { UnauthorizedPage } from '@/pages/UsersPage';
import NotFoundPage from '@/pages/NotFoundPage';

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<PasswordRoute />}><Route path="/change-password" element={<ChangePasswordPage />} /></Route>
    <Route element={<ProtectedRoute />}><Route element={<AppLayout />}><Route path="/dashboard" element={<DashboardPage />} /><Route path="/profile" element={<ProfilePage />} /><Route path="/users" element={<UsersPage />} /><Route path="/unauthorized" element={<UnauthorizedPage />} /></Route></Route>
    <Route path="/" element={<Navigate to="/dashboard" replace />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
