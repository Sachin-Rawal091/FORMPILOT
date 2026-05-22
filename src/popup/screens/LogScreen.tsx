import React, { useState, useEffect } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { LogTable } from '../components/LogTable';
import { LogEntry } from '../../types';
import { getDB } from '../../storage/db';

export const LogScreen: React.FC = () => {
  const { executionState, recentLogs, loadLogs } = useFormPilotStore();
  
  const [logsList, setLogsList] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'FILLED' | 'WARN' | 'FAILED'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Hydrate logs from store or load most recent historic session on mount
  useEffect(() => {
    const hydrateLogs = async () => {
      if (executionState && executionState.sessionId) {
        await loadLogs(executionState.sessionId);
        // Don't read recentLogs here — it's stale. The second useEffect syncs it.
      } else {
        // Find most recent sessionId in database
        try {
          const db = await getDB();
          const allLogs = await db.getAll('logs');
          
          if (allLogs.length > 0) {
            // Sort by timestamp desc to find latest session
            allLogs.sort((a, b) => b.timestamp - a.timestamp);
            const latestSessionId = allLogs[0].sessionId;
            
            // Filter logs for this session
            const sessionLogs = allLogs.filter(log => log.sessionId === latestSessionId);
            setLogsList(sessionLogs.sort((a, b) => b.timestamp - a.timestamp));
          }
        } catch (err) {
          console.error("Failed to query historic logs database:", err);
        }
      }
    };

    hydrateLogs();
  }, [executionState, recentLogs.length]);

  // Handle live logs update when active session is running
  useEffect(() => {
    if (recentLogs.length > 0) {
      setLogsList(recentLogs);
    }
  }, [recentLogs]);

  // Filtering and Searching
  const filteredLogs = logsList.filter(log => {
    // Search filter
    const matchesSearch = 
      log.selector.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.value && log.value.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (log.error && log.error.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    // Category filter
    if (filter === 'ALL') return true;
    if (filter === 'FILLED') {
      return log.status === 'FILLED' || log.status === 'FILLED_DEFAULT' || log.status === 'FILLED_COERCED' || log.status === 'SUCCESS';
    }
    if (filter === 'WARN') {
      return log.status === 'WARN' || log.status === 'RETRIED';
    }
    if (filter === 'FAILED') {
      return log.status === 'FAILED' || log.status === 'ROW_SKIPPED' || log.status === 'CAPTCHA_DETECTED';
    }
    return true;
  });

  // Export CSV
  const handleExportCSV = () => {
    if (logsList.length === 0) return;

    const headers = ['Timestamp', 'Row Index', 'Action', 'Selector', 'Value', 'Status', 'Error', 'Duration (ms)'];
    const rows = logsList.map(log => [
      new Date(log.timestamp).toISOString(),
      log.rowIndex,
      log.action,
      `"${log.selector.replace(/"/g, '""')}"`,
      log.value ? `"${log.value.replace(/"/g, '""')}"` : '',
      log.status,
      log.error ? `"${log.error.replace(/"/g, '""')}"` : '',
      log.duration
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `formpilot_logs_${logsList[0]?.sessionId || 'session'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export JSON
  const handleExportJSON = () => {
    if (logsList.length === 0) return;

    const jsonString = JSON.stringify(logsList, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `formpilot_logs_${logsList[0]?.sessionId || 'session'}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3.5 animate-fade-in h-[430px]">
      
      {/* Search and Exports panel */}
      <div className="flex flex-col gap-2 p-3 border rounded-2xl bg-slate-900/40 border-slate-800/80">
        <div className="relative">
          <input
            type="text"
            placeholder="Search logs by selector or value..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-[11px] border rounded-lg bg-slate-950 border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition pl-7"
          />
          <div className="absolute left-2.5 top-2.5 text-slate-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Exporters */}
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={logsList.length === 0}
            className="flex-1 py-1 px-3 border border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 font-semibold text-[10px] rounded-lg active:scale-95 transition flex items-center justify-center gap-1 disabled:opacity-30 disabled:pointer-events-none"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          
          <button
            onClick={handleExportJSON}
            disabled={logsList.length === 0}
            className="flex-1 py-1 px-3 border border-indigo-500/30 hover:border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 font-semibold text-[10px] rounded-lg active:scale-95 transition flex items-center justify-center gap-1 disabled:opacity-30 disabled:pointer-events-none"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export JSON
          </button>
        </div>
      </div>

      {/* Categories Filter Toggles */}
      <div className="flex gap-1.5 p-1 border rounded-xl bg-slate-950 border-slate-900 text-[10px] font-bold text-slate-400">
        <button
          onClick={() => setFilter('ALL')}
          className={`flex-1 py-1 rounded-lg transition active:scale-95 ${filter === 'ALL' ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-900 hover:text-slate-200'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('FILLED')}
          className={`flex-1 py-1 rounded-lg transition active:scale-95 ${filter === 'FILLED' ? 'bg-emerald-600/90 text-white shadow-md' : 'hover:bg-slate-900 hover:text-slate-200'}`}
        >
          Filled
        </button>
        <button
          onClick={() => setFilter('WARN')}
          className={`flex-1 py-1 rounded-lg transition active:scale-95 ${filter === 'WARN' ? 'bg-amber-600/90 text-white shadow-md' : 'hover:bg-slate-900 hover:text-slate-200'}`}
        >
          Warnings
        </button>
        <button
          onClick={() => setFilter('FAILED')}
          className={`flex-1 py-1 rounded-lg transition active:scale-95 ${filter === 'FAILED' ? 'bg-rose-600/90 text-white shadow-md' : 'hover:bg-slate-900 hover:text-slate-200'}`}
        >
          Failed
        </button>
      </div>

      {/* Logs output stream */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950/20 border border-slate-800/30 p-2.5 rounded-2xl">
        <LogTable logs={filteredLogs} maxHeight="h-[210px]" />
      </div>
    </div>
  );
};
