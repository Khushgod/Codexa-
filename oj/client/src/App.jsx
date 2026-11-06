import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { AdminRoute, ProtectedRoute } from './components/ProtectedRoute.jsx';
import { ProfilePage, SubmissionsPage } from './pages/AccountPages.jsx';
import { HomePage, DashboardPage } from './pages/HomePage.jsx';
import { LoginPage, SignupPage } from './pages/AuthPages.jsx';
import { AdminProblemsPage } from './pages/AdminProblemsPage.jsx';
import { ProblemsPage } from './pages/ProblemsPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route path="/problems/:slug" element={<WorkspacePage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/submissions" element={<SubmissionsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminProblemsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/problems" replace />} />
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}
