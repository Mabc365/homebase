import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { LayoutDashboard, Terminal as TerminalIcon, Box, LogOut, User, Menu, X, Settings, HardDrive } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import axios from 'axios';
import Overview from './pages/Overview';
import Terminal from './pages/Terminal';
import Docker from './pages/Docker';
import Login from './pages/Login';
import System from './pages/System';
import NAS from './pages/NAS';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  || (window.location.port === '5173' ? `http://${window.location.hostname}:3001` : '');

axios.defaults.baseURL = apiBaseUrl;

// Configure axios to include token in all requests
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

const SidebarItem = ({ icon: Icon, label, to, active, onClick }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </Link>
);

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

const Layout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = JSON.parse(localStorage.getItem('user') || '{"name": "xube"}');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // Close sidebar when route changes (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (location.pathname === '/login') return children;

  const path = location.pathname;

  return (
    <div className="flex h-screen bg-[#0d1117] text-slate-200 font-sans overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 border-r border-slate-800 flex flex-col p-4 bg-[#0d1117] transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <div className="mb-8 px-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-blue-500 tracking-tight">Homebase</h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-slate-400 hover:text-white"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="Overview" to="/" active={path === '/'} />
          <SidebarItem icon={TerminalIcon} label="Terminal" to="/terminal" active={path === '/terminal'} />
          <SidebarItem icon={Box} label="Docker" to="/docker" active={path === '/docker'} />
          <SidebarItem icon={HardDrive} label="NAS" to="/nas" active={path === '/nas'} />
          <SidebarItem icon={Settings} label="System" to="/system" active={path === '/system'} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Bar */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1 text-slate-400 hover:text-white"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <div className="text-xs sm:text-sm text-slate-500 truncate">Home Server Operations Center</div>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4 shrink-0">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User size={16} />
              </div>
              <span className="hidden sm:inline text-sm font-medium">{user?.name}</span>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors" aria-label="Log out">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Toaster position="bottom-right" />
      <Layout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Overview /></ProtectedRoute>} />
          <Route path="/terminal" element={<ProtectedRoute><Terminal /></ProtectedRoute>} />
          <Route path="/docker" element={<ProtectedRoute><Docker /></ProtectedRoute>} />
          <Route path="/nas" element={<ProtectedRoute><NAS /></ProtectedRoute>} />
          <Route path="/system" element={<ProtectedRoute><System /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
