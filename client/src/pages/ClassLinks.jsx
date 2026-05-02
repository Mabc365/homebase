import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, ExternalLink, Search } from 'lucide-react';

const ClassLinks = () => {
  const [links, setLinks] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchLinks = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3001/api/links`);
        setLinks(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLinks();
  }, []);

  const filteredLinks = links.filter(l => 
    l.title.toLowerCase().includes(search.toLowerCase()) || 
    l.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Class Links</h2>
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              type="text" 
              placeholder="Search links..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500 w-64"
            />
          </div>
          <button className="bg-blue-600 hover:bg-blue-500 flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={18} />
            <span>Add Link</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredLinks.map(link => (
          <a 
            key={link.id} 
            href={link.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-slate-900 border border-slate-800 p-5 rounded-xl hover:border-blue-500/50 transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-opacity-10 ${link.color || 'bg-blue-500'} ${link.color?.replace('bg-', 'text-') || 'text-blue-500'}`}>
                <ExternalLink size={20} />
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{link.category}</span>
            </div>
            <h4 className="font-bold text-white mb-1 group-hover:text-blue-400 transition-colors">{link.title}</h4>
            <p className="text-xs text-slate-500 line-clamp-2">{link.notes || 'No additional notes.'}</p>
          </a>
        ))}
      </div>
    </div>
  );
};

export default ClassLinks;
