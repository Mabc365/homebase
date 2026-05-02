import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Filter, MoreVertical } from 'lucide-react';

const ProjectBoard = () => {
  const [projects, setProjects] = useState([]);
  const [filter, setFilter] = useState('All');
  const orgs = ['All', 'Haqqconsulting', 'Tareeq Al Haqq', 'School', 'Personal'];

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3001/api/projects`);
        setProjects(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchProjects();
  }, []);

  const columns = ['To Do', 'In Progress', 'Done'];

  const filteredProjects = filter === 'All' 
    ? projects 
    : projects.filter(p => p.org === filter);

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Project Board</h2>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
            <Filter size={14} className="text-slate-500" />
            <select 
              value={filter} 
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent text-sm focus:outline-none"
            >
              {orgs.map(org => <option key={org} value={org}>{org}</option>)}
            </select>
          </div>
          <button className="bg-blue-600 hover:bg-blue-500 flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={18} />
            <span>New Task</span>
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
        {columns.map(col => (
          <div key={col} className="flex flex-col bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-semibold text-slate-400 uppercase text-xs tracking-widest">{col}</h3>
              <span className="bg-slate-800 text-slate-500 text-[10px] px-2 py-0.5 rounded-full">
                {filteredProjects.filter(p => p.status === col).length}
              </span>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
              {filteredProjects.filter(p => p.status === col).map(project => (
                <div key={project.id} className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm hover:border-slate-700 transition-colors group">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      project.priority === 'High' ? 'bg-red-500/10 text-red-500' : 
                      project.priority === 'Med' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {project.priority}
                    </span>
                    <button className="text-slate-600 group-hover:text-slate-400"><MoreVertical size={14} /></button>
                  </div>
                  <h4 className="font-medium text-white mb-1">{project.title}</h4>
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">{project.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-blue-400 font-mono">{project.org}</span>
                    {project.due_date && <span className="text-[10px] text-slate-600">{project.due_date}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectBoard;
