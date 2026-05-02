import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { LayoutDashboard, Terminal as TerminalIcon, Box, ClipboardList, Link as LinkIcon, LogOut, User } from 'lucide-react';
import axios from 'axios';
import Overview from './pages/Overview';
import Terminal from './pages/Terminal';
import Docker from './pages/Docker';
import ProjectBoard from './pages/ProjectBoard';
import ClassLinks from './pages/ClassLinks';
import Login from './pages/Login';

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

const SidebarItem = ({ icon: Icon, label, to, active }) => (
  <Link to={to} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
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
  const user = JSON.parse(localStorage.getItem('user') || '{"name": "xube"}');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const isLoginPage = window.location.pathname === '/login';
  if (isLoginPage) return children;

  return (
    <div className="flex h-screen bg-[#0d1117] text-slate-200 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 flex flex-col p-4">
        <div className="mb-8 px-2">
          <h1 className="text-2xl font-bold text-blue-500 tracking-tight">Homebase</h1>
        </div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="Overview" to="/" active={window.location.pathname === '/'} />
          <SidebarItem icon={TerminalIcon} label="Terminal" to="/terminal" active={window.location.pathname === '/terminal'} />
          <SidebarItem icon={Box} label="Docker" to="/docker" active={window.location.pathname === '/docker'} />
          <SidebarItem icon={ClipboardList} label="Project Board" to="/projects" active={window.location.pathname === '/projects'} />
          <SidebarItem icon={LinkIcon} label="Class Links" to="/links" active={window.location.pathname === '/links'} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8">
          <div className="text-sm text-slate-500">Home Server Operations Center</div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User size={16} />
              </div>
              <span className="text-sm font-medium">{user?.name}</span>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Overview /></ProtectedRoute>} />
          <Route path="/terminal" element={<ProtectedRoute><Terminal /></ProtectedRoute>} />
          <Route path="/docker" element={<ProtectedRoute><Docker /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute><ProjectBoard /></ProtectedRoute>} />
          <Route path="/links" element={<ProtectedRoute><ClassLinks /></ProtectedRoute>} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
