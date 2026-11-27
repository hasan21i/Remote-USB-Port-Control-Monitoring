import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// --- Context Providers ---
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { DeviceProvider } from './context/DeviceContext';
import { ServerProvider } from './context/ServerContext';
import { AppInfoProvider } from './context/AppInfoContext';

// --- Hooks ---
import useAuth from './hooks/useAuth';

// --- Pages ---
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import DeviceList from './pages/devices/Devicelist';
import DeviceDetails from './pages/devices/Devicedetails';
import AddDevice from './pages/devices/Adddevice';
import DeviceScan from './pages/devices/Devicescan';
import Compatibility from './pages/devices/Compatibility';
import Whitelist from './pages/security/Whitelist';
import Blacklist from './pages/security/Blacklist';
import Policies from './pages/security/Policies';
import Logs from './pages/monitoring/Logs';
import Alerts from './pages/monitoring/Alerts';
import Blockchain from './pages/monitoring/Blockchain';
import Stats from './pages/analytics/Stats';
import Reports from './pages/analytics/Reports';
import AiAnalysis from './pages/analytics/Ai-analysis';
import Profile from './pages/settings/Profile';
import System from './pages/settings/System';
import Activation from './pages/settings/Activation';
import Users from './pages/settings/Users';
import ServerList from './pages/servers/ServerList';
import ServerDetails from './pages/servers/ServerDetails';
import ServerHeartbeat from './pages/servers/ServerHeartbeat';
import HASettings from './pages/settings/HASettings';
import ReportReader from './pages/reports/ReportReader';

import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Footer from './components/Footer';

import './styles/main.css';


/**
 * Layout for unauthenticated pages
 */
const AuthLayout = ({ children }) => (
  <div className="auth-layout">{children}</div>
);
AuthLayout.propTypes = {
  children: PropTypes.node.isRequired,
};

/**
 * Main layout for authenticated pages
 */
const MainLayout = ({ children }) => {
  const { isDark } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  
  useEffect(() => {
    document.body.classList.toggle('dark-theme', isDark);
  }, [isDark]);
  
  // تحديث margin عند تغيير حالة الـ sidebar
  useEffect(() => {
    const container = document.querySelector('.main-container');
    if (container) {
      container.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    }
  }, [sidebarCollapsed]);
  
  return (
    <div className={`main-layout ${isDark ? 'dark-theme' : 'light-theme'}`}>
      <Header />
      <div className={`main-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Sidebar onCollapse={setSidebarCollapsed} />
        <main className="content">{children}</main>
      </div>
      <Footer />
    </div>
  );
};
MainLayout.propTypes = {
  children: PropTypes.node.isRequired,
};

/**
 * Centralized ProtectedRoute with roles support
 */
const ProtectedRoute = ({ children, roles = [] }) => {
  const { isAuthenticated, isLoading, currentUser, checkAuthStatus } = useAuth();
  useEffect(() => {
    checkAuthStatus().catch(error => {
      console.warn('Auth check failed:', error);
    });
  }, [checkAuthStatus]);

  if (isLoading) {
    return <div className="loading">جاري التحميل...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // تحقق من الأدوار إذا تم تحديدها
  if (roles.length > 0 && currentUser) {
    // استخدم currentUser.roles إذا كان موجوداً، وإلا استخدم [currentUser.role]
    const userRoles = (currentUser.roles && currentUser.roles.length > 0) 
      ? currentUser.roles 
      : [currentUser.role].filter(Boolean);
    
    const hasRequiredRole = roles.some(role => userRoles.includes(role));
    if (!hasRequiredRole) {
      return <div className="error">لا تملك الصلاحية للوصول لهذه الصفحة</div>;
    }
  }

  return children;
};
ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
  roles: PropTypes.arrayOf(PropTypes.string),
};

// Context Providers Wrappers
const ProtectedDeviceRoute = ({ children, roles }) => (
  <ProtectedRoute roles={roles}>
    <DeviceProvider>{children}</DeviceProvider>
  </ProtectedRoute>
);
ProtectedDeviceRoute.propTypes = {
  children: PropTypes.node.isRequired,
  roles: PropTypes.arrayOf(PropTypes.string),
};
const ProtectedServerRoute = ({ children, roles }) => (
  <ProtectedRoute roles={roles}>
    <ServerProvider>{children}</ServerProvider>
  </ProtectedRoute>
);
ProtectedServerRoute.propTypes = {
  children: PropTypes.node.isRequired,
  roles: PropTypes.arrayOf(PropTypes.string),
};

// إزالة مؤقتة للمتغيرات غير المستخدمة
// eslint-disable-next-line no-unused-vars
function App() {
  
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppInfoProvider>
          <Router 
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true
            }}
          >
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<AuthLayout><Login /></AuthLayout>} />
            <Route path="/register" element={<AuthLayout><Register /></AuthLayout>} />
            <Route path="/forgot-password" element={<AuthLayout><ForgotPassword /></AuthLayout>} />
            <Route path="/reset-password/:token" element={<AuthLayout><ResetPassword /></AuthLayout>} />

            {/* Dashboard - للجميع بعد تسجيل الدخول */}
            <Route path="/dashboard" element={
              <ProtectedDeviceRoute>
                <MainLayout><Dashboard /></MainLayout>
              </ProtectedDeviceRoute>
            } />

            {/* Devices - للجميع */}
            <Route path="/devices" element={
              <ProtectedDeviceRoute>
                <MainLayout><DeviceList /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/devices/details" element={
              <ProtectedDeviceRoute>
                <MainLayout><DeviceDetails /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/devices/add" element={
              <ProtectedDeviceRoute>
                <MainLayout><AddDevice /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/devices/scan" element={
              <ProtectedDeviceRoute>
                <MainLayout><DeviceScan /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/devices/compatibility" element={
              <ProtectedDeviceRoute>
                <MainLayout><Compatibility /></MainLayout>
              </ProtectedDeviceRoute>
            } />

            {/* Security - فقط للمدير أو الأدمن */}
            <Route path="/security/whitelist" element={
              <ProtectedDeviceRoute roles={['manager', 'admin']}>
                <MainLayout><Whitelist /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/security/blacklist" element={
              <ProtectedDeviceRoute roles={['manager', 'admin']}>
                <MainLayout><Blacklist /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/security/policies" element={
              <ProtectedDeviceRoute roles={['manager', 'admin']}>
                <MainLayout><Policies /></MainLayout>
              </ProtectedDeviceRoute>
            } />

            {/* Monitoring - للجميع */}
            <Route path="/monitoring/logs" element={
              <ProtectedDeviceRoute>
                <MainLayout><Logs /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/monitoring/alerts" element={
              <ProtectedDeviceRoute>
                <MainLayout><Alerts /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/monitoring/blockchain" element={
              <ProtectedServerRoute>
                <MainLayout><Blockchain /></MainLayout>
              </ProtectedServerRoute>
            } />

            {/* Analytics - للجميع */}
            <Route path="/analytics/stats" element={
              <ProtectedDeviceRoute>
                <MainLayout><Stats /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/analytics/reports" element={
              <ProtectedDeviceRoute>
                <MainLayout><Reports /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/analytics/ai-analysis" element={
              <ProtectedDeviceRoute>
                <MainLayout><AiAnalysis /></MainLayout>
              </ProtectedDeviceRoute>
            } />

            {/* Reports - فقط للمدير أو الأدمن */}

            <Route path="/reports/read/:id" element={<ReportReader />} />

            {/* Servers - فقط للأدمن */}
            <Route path="/servers" element={
              <ProtectedServerRoute roles={['admin']}>
                <MainLayout><ServerList /></MainLayout>
              </ProtectedServerRoute>
            } />
            <Route path="/servers/search" element={
              <ProtectedServerRoute roles={['admin']}>
                <MainLayout><ServerList /></MainLayout>
              </ProtectedServerRoute>
            } />
            <Route path="/servers/details" element={
              <ProtectedServerRoute roles={['admin']}>
                <MainLayout><ServerDetails /></MainLayout>
              </ProtectedServerRoute>
            } />
            <Route path="/servers/details/:id" element={
              <ProtectedServerRoute roles={['admin']}>
                <MainLayout><ServerDetails /></MainLayout>
              </ProtectedServerRoute>
            } />
           
            <Route path="/servers/heartbeat" element={
              <ProtectedServerRoute roles={['admin']}>
                <MainLayout><ServerHeartbeat /></MainLayout>
              </ProtectedServerRoute>
            } />

            {/* Settings - فقط للأدمن */}
            <Route path="/settings/profile" element={
              <ProtectedDeviceRoute>
                <MainLayout><Profile /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/settings/system" element={
              <ProtectedDeviceRoute roles={['admin']}>
                <MainLayout><System /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/settings/activation" element={
              <ProtectedDeviceRoute roles={['admin']}>
                <MainLayout><Activation /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            <Route path="/settings/users" element={
              <ProtectedDeviceRoute roles={['admin', 'manager']}>
                <MainLayout><Users /></MainLayout>
              </ProtectedDeviceRoute>
            } />
            {/* HA Settings - فقط للأدمن */}
            <Route path="/settings/ha" element={
              <ProtectedDeviceRoute roles={['admin']}>
                <MainLayout><HASettings /></MainLayout>
              </ProtectedDeviceRoute>
            } />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
        </AppInfoProvider>
      </ThemeProvider>
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick={false}
        rtl={false}
        pauseOnFocusLoss
        draggable={false}
        pauseOnHover
        theme="colored"
      />
    </AuthProvider>
  );
}

export default App;
