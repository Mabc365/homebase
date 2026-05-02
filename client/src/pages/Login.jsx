import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await axios.post(`http://${window.location.hostname}:3001/api/login`, { username, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/');
    } catch (err) {
      setError('Invalid username or password');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-blue-500 mb-2">Homebase</h1>
          <p className="text-slate-400">Home Server Operations Center</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded-lg text-center">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-500 uppercase tracking-widest ml-1">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Enter username"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-500 uppercase tracking-widest ml-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Enter password"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-blue-600/20"
          >
            Sign In
          </button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500">Self-Hosted</span></div>
          </div>

          <p className="text-center text-xs text-slate-600 leading-relaxed">
            All data is stored locally on your home server.
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
