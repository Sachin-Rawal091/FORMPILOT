import React, { useState, useEffect, useMemo } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { LogEntry, SelectorStrategy, Recording, Action } from '../../types';
import { StorageManager } from '../../storage/StorageManager';

export const LogScreen: React.FC = () => {
  const { executionState, recentLogs, recordings, loadRecordings } = useFormPilotStore();
  
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<Recording | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'FILLED' | 'WARN' | 'FAILED'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Load recordings and historic logs on mount
  useEffect(() => {
    const loadAllData = async () => {
      await loadRecordings();
      try {
        const logs = await StorageManager.getHistoricLogs();
        setAllLogs(logs);
      } catch (err) {
        console.error("Failed to load historic logs:", err);
      }
    };
    loadAllData();
  }, [loadRecordings]);

  // Sync recent logs when active session is running
  useEffect(() => {
    if (recentLogs.length > 0) {
      setAllLogs(prev => {
        const otherLogs = prev.filter(l => l.sessionId !== recentLogs[0].sessionId);
        return [...recentLogs, ...otherLogs];
      });
    }
  }, [recentLogs]);

  // Auto-focus on the active running session if one exists
  useEffect(() => {
    if (executionState && executionState.sessionId && executionState.recordingId) {
      const activeRec = recordings.find(r => r.id === executionState.recordingId);
      if (activeRec) {
        setActiveWorkflow(activeRec);
        setSelectedSessionId(executionState.sessionId);
      }
    }
  }, [executionState?.sessionId, executionState?.recordingId, recordings]);

  // Group all logs by sessionId
  const sessionsMap = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    allLogs.forEach(log => {
      if (!map.has(log.sessionId)) {
        map.set(log.sessionId, []);
      }
      map.get(log.sessionId)!.push(log);
    });
    return map;
  }, [allLogs]);

  // Create sorted session list
  const sessions = useMemo(() => {
    const list: { sessionId: string; timestamp: number; logs: LogEntry[] }[] = [];
    sessionsMap.forEach((logs, sessionId) => {
      const timestamp = Math.max(...logs.map(l => l.timestamp));
      list.push({
        sessionId,
        timestamp,
        logs: logs.sort((a, b) => b.timestamp - a.timestamp)
      });
    });
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [sessionsMap]);

  // Map sessions to recordings
  const workflowSessions = useMemo(() => {
    const map = new Map<string, typeof sessions>();
    
    sessions.forEach(session => {
      const stepIds = new Set(session.logs.map(l => l.stepId));
      const matchedRec = recordings.find(rec => {
        if (executionState && executionState.sessionId === session.sessionId) {
          return rec.id === executionState.recordingId;
        }
        return rec.steps.some(step => stepIds.has(step.id));
      });
      
      if (matchedRec) {
        if (!map.has(matchedRec.id)) {
          map.set(matchedRec.id, []);
        }
        map.get(matchedRec.id)!.push(session);
      }
    });
    
    return map;
  }, [sessions, recordings, executionState]);

  // List of workflows with status metadata
  const workflowsWithStatus = useMemo(() => {
    return recordings.map(rec => {
      const recSessions = workflowSessions.get(rec.id) || [];
      const runCount = recSessions.length;
      let lastRunTimestamp: number | null = null;
      let lastRunStatus = 'NO RUNS';
      
      if (runCount > 0) {
        const latestSession = recSessions[0];
        lastRunTimestamp = latestSession.timestamp;
        const hasFailures = latestSession.logs.some(l => l.status === 'FAILED' || l.status === 'ROW_SKIPPED');
        lastRunStatus = hasFailures ? 'FAILED' : 'SUCCESS';
      }
      
      return {
        recording: rec,
        runCount,
        lastRunTimestamp,
        lastRunStatus
      };
    });
  }, [recordings, workflowSessions]);

  // Selected session's active logs
  const activeLogs = useMemo(() => {
    if (!activeWorkflow) return [];
    
    if (executionState && executionState.sessionId && selectedSessionId === executionState.sessionId && recentLogs.length > 0) {
      return recentLogs;
    }
    
    return sessionsMap.get(selectedSessionId || '') || [];
  }, [selectedSessionId, activeWorkflow, recentLogs, sessionsMap, executionState]);

  // Compute metrics for the active logs
  const sessionMetrics = useMemo(() => {
    const rowsMap = new Map<number, { failed: boolean; warned: boolean; filled: boolean }>();
    
    activeLogs.forEach(log => {
      if (!rowsMap.has(log.rowIndex)) {
        rowsMap.set(log.rowIndex, { failed: false, warned: false, filled: false });
      }
      const r = rowsMap.get(log.rowIndex)!;
      
      if (log.status === 'SUCCESS' || log.status === 'FILLED' || log.status === 'FILLED_DEFAULT' || log.status === 'FILLED_COERCED') {
        r.filled = true;
      }
      if (log.status === 'FAILED' || log.status === 'ROW_SKIPPED') {
        r.failed = true;
      }
      if (log.status === 'WARN' || log.status === 'RETRIED') {
        r.warned = true;
      }
    });
    
    let filledCount = 0;
    let failedCount = 0;
    let warnedCount = 0;
    
    rowsMap.forEach(r => {
      if (r.failed) {
        failedCount++;
      } else if (r.warned) {
        warnedCount++;
        filledCount++;
      } else {
        filledCount++;
      }
    });
    
    return {
      filled: filledCount,
      failed: failedCount,
      warnings: warnedCount,
      total: rowsMap.size
    };
  }, [activeLogs]);

  // Auto select first log entry when session logs change
  useEffect(() => {
    if (activeLogs.length > 0) {
      if (!selectedLog || !activeLogs.some(l => l.id === selectedLog.id)) {
        setSelectedLog(activeLogs[0]);
      }
    } else {
      setSelectedLog(null);
    }
  }, [selectedSessionId, activeLogs]);

  // Filter and search active logs
  const filteredLogs = useMemo(() => {
    return activeLogs.filter(log => {
      const matchesSearch = 
        log.selector.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.value && log.value.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.error && log.error.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchesSearch) return false;

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
  }, [activeLogs, searchTerm, filter]);

  // Export CSV
  const handleExportCSV = () => {
    if (activeLogs.length === 0) return;

    const headers = ['Timestamp', 'Row Index', 'Action', 'Selector', 'Value', 'Status', 'Error', 'Duration (ms)'];
    const rows = activeLogs.map(log => [
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
    const filename = `formpilot_logs_${selectedSessionId || 'session'}.csv`;

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    } else {
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  };

  // Export JSON
  const handleExportJSON = () => {
    if (activeLogs.length === 0) return;

    const jsonString = JSON.stringify(activeLogs, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `formpilot_logs_${selectedSessionId || 'session'}.json`;

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    } else {
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'FILLED':
      case 'SUCCESS':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'FILLED_DEFAULT':
      case 'FILLED_COERCED':
        return 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      case 'STEP_SKIPPED':
        return 'text-slate-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
      case 'WARN':
      case 'RETRIED':
        return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'ROW_SKIPPED':
      case 'CAPTCHA_DETECTED':
      case 'FAILED':
      default:
        return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20';
    }
  };

  const getStrategyName = (strategy?: SelectorStrategy) => {
    if (strategy === undefined) return 'Direct CSS query';
    switch (strategy) {
      case SelectorStrategy.ID: return 'Element ID Match';
      case SelectorStrategy.NAME: return 'Form Input Name Match';
      case SelectorStrategy.ARIA_LABEL: return 'Aria Accessible Label';
      case SelectorStrategy.LABEL_LINKED: return 'Connected Text Label';
      case SelectorStrategy.PLACEHOLDER: return 'Placeholder Text Match';
      case SelectorStrategy.CSS_PATH: return 'Canonical CSS Path';
      case SelectorStrategy.XPATH: return 'Strict XPath Query';
      case SelectorStrategy.SHADOW_DOM: return 'Shadow DOM Traversal';
      default: return 'Dynamic query selector';
    }
  };

  const getLogFriendlyText = (log: LogEntry) => {
    const step = activeWorkflow?.steps.find(s => s.id === log.stepId);
    
    // Find friendly label name
    let friendlyName = '';
    if (step?.selectorMeta) {
      const meta = step.selectorMeta;
      friendlyName = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || '';
    }
    
    friendlyName = friendlyName.trim().replace(/\s+/g, ' ');

    // Fallback: If no friendly label name, clean up CSS/XPath selector slightly
    if (!friendlyName) {
      friendlyName = log.selector;
    }

    // Format output
    switch (log.action) {
      case Action.FILL:
      case Action.SELECT:
      case Action.SELECT_RADIO:
        return log.value !== undefined ? `Fill "${friendlyName}" with "${log.value}"` : `Fill "${friendlyName}"`;
      case Action.TOGGLE_CHECKBOX:
        return `${log.value === 'true' || log.value === 'checked' ? 'Check' : 'Uncheck'} "${friendlyName}"`;
      case Action.CLICK:
        return `Click "${friendlyName}"`;
      default:
        // E.g., WAIT, SCROLL, SUBMIT
        return `${Action[log.action] || 'Action'} on "${friendlyName}"`;
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/60">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-black font-outfit tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 dark:from-white dark:via-indigo-200 dark:to-white">
            Activity Logger
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
            Inspect, filter, and export diagnostic logs and element matching reports from execution sessions.
          </p>
        </div>

        {activeWorkflow && activeLogs.length > 0 && (
          <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all active:scale-95 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>CSV</span>
            </button>
            <button
              onClick={handleExportJSON}
              className="px-4 py-2 border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all active:scale-95 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>JSON</span>
            </button>
          </div>
        )}
      </div>

      {/* MASTER VIEW (Workflows List) */}
      {!activeWorkflow ? (
        <div className="space-y-6">
          <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-1">
            Saved Workflows
          </div>
          
          {workflowsWithStatus.length === 0 ? (
            <div className="p-16 text-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/40 dark:bg-slate-950/5 flex flex-col items-center justify-center gap-4">
              <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-600">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V4a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">No saved workflows found</h4>
                <p className="text-xs text-slate-400">Record a new workflow on the homepage to start tracking logs.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {workflowsWithStatus.map(({ recording, runCount, lastRunTimestamp, lastRunStatus }) => (
                <div
                  key={recording.id}
                  onClick={() => {
                    setActiveWorkflow(recording);
                    const recSessions = workflowSessions.get(recording.id) || [];
                    if (recSessions.length > 0) {
                      setSelectedSessionId(recSessions[0].sessionId);
                    } else {
                      setSelectedSessionId(null);
                    }
                  }}
                  className="group p-6 border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/10 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-2xl transition-all duration-200 cursor-pointer flex flex-col justify-between shadow-[0_4px_20px_rgba(0,0,0,0.015)] hover:shadow-indigo-500/[0.02] active:scale-[0.99]"
                >
                  <div className="space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 min-w-0">
                        <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 font-outfit transition truncate">
                          {recording.name}
                        </h3>
                        <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                          {recording.siteUrl}
                        </p>
                      </div>
                      
                      {/* Last run status badge */}
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider shrink-0 ${
                        lastRunStatus === 'SUCCESS'
                          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : lastRunStatus === 'FAILED'
                          ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
                          : 'text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/20'
                      }`}>
                        {lastRunStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Steps Count</span>
                        <span className="font-extrabold text-slate-700 dark:text-slate-300 mt-0.5 block">{recording.steps.length} steps</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Run History</span>
                        <span className="font-extrabold text-slate-700 dark:text-slate-300 mt-0.5 block">{runCount} runs</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      {lastRunTimestamp 
                        ? `Last run: ${new Date(lastRunTimestamp).toLocaleString()}` 
                        : 'No runs recorded'}
                    </span>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform flex items-center gap-1.5">
                      <span>View Logs</span>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* DETAIL VIEW */
        <div className="space-y-8 animate-fade-in">
          
          {/* Breadcrumbs & Navigation */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-2.5 text-xs font-bold text-slate-400 dark:text-slate-500">
              <button 
                onClick={() => {
                  setActiveWorkflow(null);
                  setSelectedSessionId(null);
                }}
                className="hover:text-indigo-500 dark:hover:text-indigo-400 transition flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Workflows</span>
              </button>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="text-slate-700 dark:text-slate-300 font-extrabold max-w-[240px] truncate">{activeWorkflow.name}</span>
            </div>

            {/* Run Selector Dropdown */}
            {selectedSessionId && (workflowSessions.get(activeWorkflow.id)?.length || 0) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold shrink-0">Execution Run:</span>
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="px-3.5 py-1.5 text-xs font-bold border-2 rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                >
                  {(workflowSessions.get(activeWorkflow.id) || []).map((s, idx) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {new Date(s.timestamp).toLocaleString()} {idx === 0 ? '(Latest)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Metrics Grid */}
          {selectedSessionId ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 border-2 rounded-2xl bg-gradient-to-br from-emerald-500/[0.02] to-emerald-500/[0.06] dark:from-emerald-500/[0.04] dark:to-emerald-500/[0.08] border-emerald-500/10 dark:border-emerald-500/20 flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Rows Filled</span>
                <span className="text-3xl font-black font-outfit text-emerald-600 dark:text-emerald-400 mt-1.5 font-mono">
                  {sessionMetrics.filled}
                </span>
              </div>
              <div className="p-5 border-2 rounded-2xl bg-gradient-to-br from-rose-500/[0.02] to-rose-500/[0.06] dark:from-rose-500/[0.04] dark:to-rose-500/[0.08] border-rose-500/10 dark:border-rose-500/20 flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Rows Failed</span>
                <span className="text-3xl font-black font-outfit text-rose-500 dark:text-rose-400 mt-1.5 font-mono">
                  {sessionMetrics.failed}
                </span>
              </div>
              <div className="p-5 border-2 rounded-2xl bg-gradient-to-br from-amber-500/[0.02] to-amber-500/[0.06] dark:from-amber-500/[0.04] dark:to-amber-500/[0.08] border-amber-500/10 dark:border-amber-500/20 flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Warnings</span>
                <span className="text-3xl font-black font-outfit text-amber-600 dark:text-amber-400 mt-1.5 font-mono">
                  {sessionMetrics.warnings}
                </span>
              </div>
              <div className="p-5 border-2 rounded-2xl bg-gradient-to-br from-indigo-500/[0.02] to-indigo-500/[0.06] dark:from-indigo-500/[0.04] dark:to-indigo-500/[0.08] border-indigo-500/10 dark:border-indigo-500/20 flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Total Rows</span>
                <span className="text-3xl font-black font-outfit text-indigo-600 dark:text-indigo-400 mt-1.5 font-mono">
                  {sessionMetrics.total}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-16 text-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/40 dark:bg-slate-950/5 flex flex-col items-center justify-center gap-3">
              <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Runs Stored</h4>
                <p className="text-xs text-slate-400">Launch this workflow from the home tab to capture execution logs.</p>
              </div>
            </div>
          )}

          {/* Logs Split Pane (only visible when we have a selected session) */}
          {selectedSessionId && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              
              {/* Left Pane: Logs Stream & Filtering */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                
                {/* Search bar */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by selector, value, errors..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-3 text-xs border-2 rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition pl-10"
                  />
                  <div className="absolute left-3 top-3.5 text-slate-400 dark:text-slate-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>

                {/* Category tabs */}
                <div className="flex gap-1 p-1 border-2 rounded-xl bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-900 text-xs font-bold text-slate-500">
                  <button
                    onClick={() => setFilter('ALL')}
                    className={`flex-1 py-2 rounded-lg transition-all active:scale-95 ${filter === 'ALL' ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow' : 'hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilter('FILLED')}
                    className={`flex-1 py-2 rounded-lg transition-all active:scale-95 ${filter === 'FILLED' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    Filled
                  </button>
                  <button
                    onClick={() => setFilter('WARN')}
                    className={`flex-1 py-2 rounded-lg transition-all active:scale-95 ${filter === 'WARN' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    Warnings
                  </button>
                  <button
                    onClick={() => setFilter('FAILED')}
                    className={`flex-1 py-2 rounded-lg transition-all active:scale-95 ${filter === 'FAILED' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : 'hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    Failed
                  </button>
                </div>

                {/* List Scroll pane */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-3 max-h-[460px] scrollbar-thin">
                  {filteredLogs.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-2xl bg-white/40 dark:bg-slate-950/5">
                      No logs matching filters found.
                    </div>
                  ) : (
                    filteredLogs.map((log) => {
                      const isSelected = selectedLog?.id === log.id;
                      return (
                        <div
                          key={log.id}
                          onClick={() => setSelectedLog(log)}
                          className={`p-4 border-2 rounded-2xl transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
                            isSelected 
                              ? 'border-indigo-500 bg-white dark:bg-slate-900/40 shadow shadow-indigo-500/5' 
                              : 'border-slate-200 dark:border-slate-800/80 bg-white/50 dark:bg-slate-950/5 hover:border-slate-300 dark:hover:border-slate-800'
                          }`}
                        >
                          <div className="flex justify-between items-center text-[10px] font-mono">
                            <span className="font-extrabold text-indigo-600 dark:text-indigo-400">Row {log.rowIndex + 1}</span>
                            <span className="text-slate-400 dark:text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>

                          <div className="flex items-center justify-between gap-2.5">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate block">
                                {getLogFriendlyText(log)}
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider shrink-0 ${getStatusStyle(log.status)}`}>
                              {log.status}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>

              {/* Right Pane: Step Debug inspector details */}
              <div className="lg:col-span-7 flex flex-col">
                {selectedLog ? (
                  <div className="flex-1 p-6 border-2 rounded-3xl bg-white dark:bg-slate-900/10 border-slate-200 dark:border-slate-800/80 shadow-[0_0_20px_rgba(0,0,0,0.015)] space-y-6">
                    
                    {/* Debug Header */}
                    <div className="flex justify-between items-center pb-4 border-b border-slate-200 dark:border-slate-800/80">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest font-mono">Event Inspector</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">
                          {getLogFriendlyText(selectedLog)}
                        </span>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg border text-xs font-extrabold tracking-wide uppercase ${getStatusStyle(selectedLog.status)}`}>
                        {selectedLog.status}
                      </span>
                    </div>

                    {/* Data Table */}
                    <div className="space-y-4 text-xs">
                      
                      {/* Target Selector path */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">DOM Query Selector</span>
                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all">
                          {selectedLog.selector}
                        </div>
                      </div>

                      {/* Attempted Value */}
                      {selectedLog.value !== undefined && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Input Text Value</span>
                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">
                            "{selectedLog.value}"
                          </div>
                        </div>
                      )}

                      {/* Strategy + Metrics */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50/50 dark:bg-slate-950/10 border border-slate-200 dark:border-slate-800/80 rounded-2xl flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Strategy Strategy</span>
                          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300 mt-1">
                            {getStrategyName(selectedLog.selectorStrategy)}
                          </span>
                        </div>
                        <div className="p-4 bg-slate-50/50 dark:bg-slate-950/10 border border-slate-200 dark:border-slate-800/80 rounded-2xl flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Action Duration</span>
                          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300 mt-1 font-mono">
                            {selectedLog.duration} ms
                          </span>
                        </div>
                      </div>

                      {/* Retries */}
                      {selectedLog.retryCount > 0 && (
                        <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400 font-bold font-mono">
                          ⚠️ Required {selectedLog.retryCount} retry attempts before completing stability waits.
                        </div>
                      )}

                      {/* Detailed Error message if failed */}
                      {selectedLog.error && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Failure Diagnostics Report</span>
                          <div className="p-4 rounded-xl bg-rose-500/5 dark:bg-rose-500/[0.02] border-2 border-rose-500/10 text-rose-600 dark:text-rose-400 font-mono text-[11px] leading-relaxed select-text whitespace-pre-wrap">
                            {selectedLog.error}
                          </div>
                        </div>
                      )}

                    </div>

                  </div>
                ) : (
                  <div className="flex-1 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-8 bg-white/20 dark:bg-slate-950/5 text-center flex flex-col items-center justify-center min-h-[350px] text-slate-400 dark:text-slate-500 gap-3">
                    <svg className="w-10 h-10 opacity-30 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-400 block">No Log Event Selected</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 block max-w-xs mx-auto">
                        Click on any event log in the left panel to inspect selector confidence, retry diagnostics, and duration.
                      </span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

    </div>
  );
};
