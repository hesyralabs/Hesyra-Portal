import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CaseProvider } from './context/CaseContext';
import { PaymentProvider } from './context/PaymentContext';
import { SystemProvider, useSystem } from './context/SystemContext';
import { OnboardingProvider } from './context/OnboardingContext';

// Layouts
import DashboardLayout from './components/Layout/DashboardLayout';
import TechLayout from './components/Layout/TechLayout';
import ManagerLayout from './components/Layout/ManagerLayout';
import DesignerLayout from './components/Layout/DesignerLayout';
import CeramistLayout from './components/Layout/CeramistLayout';

// Clinic Pages
import Dashboard from './pages/Dashboard/Dashboard';
import NewCase from './pages/NewCase/NewCase';
import CaseDetails from './pages/CaseDetails/CaseDetails';
import Settings from './pages/Settings/Settings';
import Archive from './pages/Archive/Archive';
import Billing from './pages/Billing/Billing';

// Tech Pages
import TechDashboard from './pages/TechDashboard/TechDashboard';
import TechCaseWorkspace from './pages/TechCaseWorkspace/TechCaseWorkspace';
import TechSettings from './pages/TechSettings/TechSettings';

// Manager Pages
import ManagerDashboard from './pages/Manager/ManagerDashboard';
import ManagerCases from './pages/Manager/ManagerCases';
import ManagerCaseDetail from './pages/Manager/ManagerCaseDetail';
import ManagerWorkload from './pages/Manager/ManagerWorkload';
import ManagerTickets from './pages/Manager/ManagerTickets';
import ManagerClinics from './pages/Manager/ManagerClinics';
import ManagerCatalog from './pages/Manager/ManagerCatalog';
import ManagerScanDay from './pages/Manager/ManagerScanDay';

// Designer Pages
import DesignerQueue from './pages/Designer/DesignerQueue';
import DesignerWorkspace from './pages/Designer/DesignerWorkspace';
import DesignerPool from './pages/Designer/DesignerPool';

// Ceramist Pages
import CeramistDashboard from './pages/Ceramist/CeramistDashboard';
import CeramistCompleted from './pages/Ceramist/CeramistCompleted';

// Auth & Context
import Login from './pages/Auth/Login';
import ForgotPassword from './pages/Auth/ForgotPassword';
import ResetPassword from './pages/Auth/ResetPassword';
import Onboarding from './pages/Auth/Onboarding';
import SuspensionScreen from './pages/Auth/SuspensionScreen';
import { NotificationProvider } from './context/NotificationContext';
import { usePayment } from './context/PaymentContext';
import SuperAdmin from './pages/SuperAdmin/SuperAdmin';

// Role → home route (single source of truth)
const HOME_BY_ROLE = {
  admin:        '/admin',
  manager:      '/manager',
  technician:   '/tech',
  cad_designer: '/designer',
  ceramist:     '/ceramist',
  dispatch:     '/dispatch',
  clinic:       '/',
};

const ProtectedRoute = ({ children, requiredRole }) => {
  const { isAuthenticated, user } = useAuth();
  const { isSuspended } = usePayment();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // If a specific role is required and doesn't match, redirect to the user's actual home
  if (requiredRole && user?.role !== requiredRole) {
    return <Navigate to={HOME_BY_ROLE[user?.role] || '/login'} replace />;
  }

  // Onboarding guard: clinic users who haven't finished setup
  if (user?.role === 'clinic' && user?.onboardingComplete === false) {
    return <Navigate to="/onboarding" replace />;
  }

  // Suspension guard: clinic accounts only
  if (user?.role === 'clinic' && isSuspended) {
    return <SuspensionScreen />;
  }

  return children;
};

const GlobalBroadcast = () => {
  const { broadcast, clearBroadcast } = useSystem();
  if (!broadcast || !broadcast.active) return null;
  return (
    <div style={{ background: '#1e293b', color: '#f8fafc', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', zIndex: 9999, fontWeight: '500', letterSpacing: '0.02em', fontSize: '0.9rem' }}>
      <span style={{ marginRight: '1rem' }}>📢 {broadcast.text}</span>
      <button onClick={clearBroadcast} style={{ position: 'absolute', right: '1rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '4px', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>Dismiss</button>
    </div>
  );
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<Onboarding />} />

      {/* Admin */}
      <Route path="/admin" element={
        <ProtectedRoute requiredRole="admin"><SuperAdmin /></ProtectedRoute>
      } />

      {/* Manager */}
      <Route path="/manager" element={
        <ProtectedRoute requiredRole="manager"><ManagerLayout /></ProtectedRoute>
      }>
        <Route index element={<ManagerDashboard />} />
        <Route path="cases" element={<ManagerCases />} />
        <Route path="case/:id" element={<ManagerCaseDetail />} />
        <Route path="workload" element={<ManagerWorkload />} />
        <Route path="tickets" element={<ManagerTickets />} />
        <Route path="clinics" element={<ManagerClinics />} />
        <Route path="catalog" element={<ManagerCatalog />} />
        <Route path="scan-day" element={<ManagerScanDay />} />
      </Route>

      {/* CAD Designer */}
      <Route path="/designer" element={
        <ProtectedRoute requiredRole="cad_designer"><DesignerLayout /></ProtectedRoute>
      }>
        <Route index element={<DesignerQueue />} />
        <Route path="pool" element={<DesignerPool />} />
        <Route path="case/:id" element={<DesignerWorkspace />} />
      </Route>

      {/* Dispatch — integrated into tech layout (dispatchPermission flag) */}
      <Route path="/dispatch" element={
        <ProtectedRoute requiredRole="dispatch">
          <div style={{ padding: '2rem', color: '#f8fafc', background: '#0f172a', minHeight: '100vh' }}>
            <h1>📦 Dispatch Queue</h1>
            <p style={{ color: '#94a3b8' }}>Dispatch interface integrated in Phase 7.</p>
          </div>
        </ProtectedRoute>
      } />

      {/* Clinic Routes */}
      <Route path="/" element={
        <ProtectedRoute requiredRole="clinic"><DashboardLayout /></ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="new-case" element={<NewCase />} />
        <Route path="new-case/:id" element={<NewCase />} />
        <Route path="case/:id" element={<CaseDetails />} />
        <Route path="archive" element={<Archive />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Lab Technician Routes */}
      <Route path="/tech" element={
        <ProtectedRoute requiredRole="technician"><TechLayout /></ProtectedRoute>
      }>
        <Route index element={<TechDashboard />} />
        <Route path="case/:id" element={<TechCaseWorkspace />} />
        <Route path="archive" element={<Archive />} />
        <Route path="settings" element={<TechSettings />} />
      </Route>

      {/* Ceramist Routes */}
      {/* Was TechLayout, whose sidebar points at /tech/* — routes a
          ceramist cannot enter, so every link bounced them back here. */}
      <Route path="/ceramist" element={
        <ProtectedRoute requiredRole="ceramist"><CeramistLayout /></ProtectedRoute>
      }>
        <Route index element={<CeramistDashboard />} />
        <Route path="completed" element={<CeramistCompleted />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

import { ToastProvider } from './context/ToastContext';

import CommandPalette from './components/UI/CommandPalette';
import ErrorBoundary from './components/UI/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      {/* No ThemeProvider: the portal has one theme, defined on :root
          in index.css. It previously carried three and a toggle that
          could only reach two of them. */}
      <BrowserRouter>
        <ToastProvider>
          <NotificationProvider>
            <AuthProvider>
              {/* SystemProvider sits inside AuthProvider: it loads
                  admin-only broadcast and audit data, so it has to wait
                  for the session before it can fetch. */}
              <SystemProvider>
                <CaseProvider>
                  <PaymentProvider>
                    <OnboardingProvider>
                      <CommandPalette />
                      <GlobalBroadcast />
                      <AppRoutes />
                    </OnboardingProvider>
                  </PaymentProvider>
                </CaseProvider>
              </SystemProvider>
            </AuthProvider>
          </NotificationProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
