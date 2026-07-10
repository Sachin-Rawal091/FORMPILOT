import React, { useState, useEffect, useMemo } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { LogEntry, SelectorStrategy, Recording, Action, SessionMeta } from '../../types';
import { StorageManager } from '../../storage/StorageManager';
import { logger } from '../../utils/logger';

export const LogScreen: React.FC = () => {
  const { executionState, recentLogs, recordings, loadRecordings } = useFormPilotStore();
  
  const [sessionMetas, setSessionMetas] = useState<SessionMeta[]>([]);
  const [activeSessionLogs, setActiveSessionLogs] = useState<LogEntry[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Map<string, string>>(new Map());
  const [activeWorkflow, setActiveWorkflow] = useState<Recording | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'FILLED' | 'WARN' | 'FAILED'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Load recordings and session metadata on mount
  useEffect(() => {
    const loadAllData = async () => {
      await loadRecordings();
      try {
        const metas = await StorageManager.getSessionMetas();
        setSessionMetas(metas);
      } catch (err) {
        logger.error('LogScreen', 'Failed to load session metas:', err);
      }
    };
    loadAllData();
  }, [loadRecordings]);

  // Fetch log statuses for each latest session to determine success/fail list
  useEffect(() => {
    const fetchLatestStatuses = async () => {
      const statusMap = new Map<string, string>();
      const latestSessions = new Map<string, SessionMeta>();
      sessionMetas.forEach(meta => {
        const existing = latestSessions.get(meta.recordingId);
        if (!existing || meta.timestamp > existing.timestamp) {
          latestSessions.set(meta.recordingId, meta);
        }
      });

      for (const [, session] of latestSessions.entries()) {
        try {
          const hasFailures = await StorageManager.hasSessionFailures(session.sessionId);
          statusMap.set(session.sessionId, hasFailures ? 'FAILED' : 'SUCCESS');
        } catch (err) {
          logger.error('LogScreen', `Failed to load logs for status check: ${session.sessionId}`, err);
        }
      }
      setSessionStatuses(statusMap);
    };

    if (sessionMetas.length > 0) {
      fetchLatestStatuses();
    }
  }, [sessionMetas]);

  // Load active session logs when selectedSessionId changes
  useEffect(() => {
    if (!selectedSessionId) {
      setActiveSessionLogs([]);
      return;
    }
    if (executionState && executionState.sessionId === selectedSessionId && recentLogs.length > 0) {
      setActiveSessionLogs(recentLogs);
      return;
    }
    const loadSessionLogs = async () => {
      try {
        const logs = await StorageManager.getLogs(selectedSessionId, 0, 500);
        setActiveSessionLogs(logs);
      } catch (err) {
        logger.error('LogScreen', `Failed to load session logs: ${selectedSessionId}`, err);
      }
    };
    loadSessionLogs();
  }, [selectedSessionId, recentLogs, executionState?.sessionId]);

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url,
        filename,
        saveAs: true
      }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
      return;
    }

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Sync recent logs when active session is running
  useEffect(() => {
    if (recentLogs.length > 0 && executionState?.sessionId) {
      const activeSessId = executionState.sessionId;
      setSessionMetas(prev => {
        if (!prev.some(m => m.sessionId === activeSessId)) {
          return [{
            sessionId: activeSessId,
            timestamp: Date.now(),
            recordingId: executionState.recordingId || 'default'
          }, ...prev];
        }
        return prev;
      });
    }
  }, [recentLogs, executionState]);

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

  // Map sessions to recordings
  const workflowSessions = useMemo(() => {
    const map = new Map<string, SessionMeta[]>();
    
    sessionMetas.forEach(session => {
      const recId = session.recordingId;
      if (recId) {
        if (!map.has(recId)) {
          map.set(recId, []);
        }
        map.get(recId)!.push(session);
      }
    });

    map.forEach((list, recId) => {
      map.set(recId, list.sort((a, b) => b.timestamp - a.timestamp));
    });
    
    return map;
  }, [sessionMetas]);

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
        lastRunStatus = sessionStatuses.get(latestSession.sessionId) || 'SUCCESS';
      }
      
      return {
        recording: rec,
        runCount,
        lastRunTimestamp,
        lastRunStatus
      };
    });
  }, [recordings, workflowSessions, sessionStatuses]);

  // Selected session's active logs
  const activeLogs = useMemo(() => {
    if (!activeWorkflow) return [];
    
    if (executionState && executionState.sessionId && selectedSessionId === executionState.sessionId && recentLogs.length > 0) {
      return recentLogs;
    }
    
    return activeSessionLogs;
  }, [selectedSessionId, activeWorkflow, recentLogs, activeSessionLogs, executionState]);

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
    const logs = activeLogs.filter(log => {
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

    // Sort ascending: oldest first, newest last
    return [...logs].sort((a, b) => a.timestamp - b.timestamp);
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
    const filename = `formpilot_logs_${selectedSessionId || 'session'}.csv`;
    downloadFile(csvContent, filename, 'text/csv');
  };

  // Export JSON
  const handleExportJSON = () => {
    if (activeLogs.length === 0) return;

    const jsonString = JSON.stringify(activeLogs, null, 2);
    const filename = `formpilot_logs_${selectedSessionId || 'session'}.json`;
    downloadFile(jsonString, filename, 'application/json');
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
    <div className="flex flex-col h-full min-h-0 gap-6 animate-fade-in">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-200/60 dark:border-slate-800/60 shrink-0">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold font-outfit tracking-wide text-slate-900 dark:text-white">
            Activity Logger
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
            Inspect, filter, and export diagnostic logs and element matching reports from execution sessions.
          </p>
        </div>

        {activeWorkflow && activeLogs.length > 0 && (
          <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-full transition-all active:scale-95 flex items-center gap-2 border border-slate-200 dark:border-slate-800"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>CSV</span>
            </button>
            <button
              onClick={handleExportJSON}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-full transition-all active:scale-95 flex items-center gap-2 border border-slate-200 dark:border-slate-800"
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
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-1 shrink-0">
            Saved Workflows
          </div>
          
          {workflowsWithStatus.length === 0 ? (
            <div className="p-16 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-card bg-white dark:bg-fp-card-dark flex flex-col items-center justify-center gap-4 shadow-sm flex-1">
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-600">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V4a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No saved workflows found</h4>
                <p className="text-xs text-slate-400">Record a new workflow on the homepage to start tracking logs.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar pr-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start content-start">
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
                  className="group p-6 bg-white dark:bg-fp-card-dark hover:shadow-md rounded-card transition-all duration-200 cursor-pointer flex flex-col justify-between shadow-sm active:scale-[0.99] border-0"
                >
                  <div className="space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 min-w-0">
                        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 group-hover:text-fp-accent dark:group-hover:text-white font-outfit transition truncate">
                          {recording.name}
                        </h3>
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">
                          {recording.siteUrl}
                        </p>
                      </div>
                      
                      {/* Last run status badge */}
                      <span className={`px-2.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                        lastRunStatus === 'SUCCESS'
                          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                          : lastRunStatus === 'FAILED'
                          ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20'
                          : 'text-slate-500 dark:text-slate-400 bg-slate-500/10 border border-slate-500/20'
                      }`}>
                        {lastRunStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800/40 text-xs text-slate-500 dark:text-slate-400">
                      <div>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 block uppercase font-semibold tracking-wider">Steps Count</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 mt-1 block">{recording.steps.length} steps</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 block uppercase font-semibold tracking-wider">Run History</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 mt-1 block">{runCount} runs</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/40">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      {lastRunTimestamp 
                        ? `Last run: ${new Date(lastRunTimestamp).toLocaleString()}` 
                        : 'No runs recorded'}
                    </span>
                    <span className="text-xs font-semibold text-fp-sidebar dark:text-white group-hover:translate-x-1 transition-transform flex items-center gap-1.5 font-outfit">
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
        <div className="flex-1 flex flex-col min-h-0 gap-6">
          
          {/* Breadcrumbs & Navigation */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
            <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-400 dark:text-slate-500">
              <button 
                onClick={() => {
                  setActiveWorkflow(null);
                  setSelectedSessionId(null);
                }}
                className="hover:text-fp-accent dark:hover:text-white transition flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Workflows</span>
              </button>
              <span className="text-slate-300 dark:text-slate-800">/</span>
              <span className="text-slate-700 dark:text-slate-300 font-semibold max-w-[240px] truncate font-outfit">{activeWorkflow.name}</span>
            </div>

            {/* Run Selector Dropdown */}
            {selectedSessionId && (workflowSessions.get(activeWorkflow.id)?.length || 0) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold shrink-0">Execution Run:</span>
                <div className="relative">
                  <select
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    className="px-4 py-2 text-xs font-semibold border rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-fp-accent dark:focus:border-white transition cursor-pointer appearance-none pr-8"
                  >
                    {(workflowSessions.get(activeWorkflow.id) || []).map((s, idx) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {new Date(s.timestamp).toLocaleString()} {idx === 0 ? '(Latest)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-2.5 top-3 pointer-events-none text-slate-500">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Metrics Grid */}
          <div className="shrink-0">
            {selectedSessionId ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Success: Filled */}
                <div className="bg-gradient-to-br from-emerald-500/20 to-transparent p-[1px] rounded-2xl">
                  <div className="bg-white dark:bg-fp-card-dark h-full rounded-2xl p-5 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-450 uppercase tracking-widest pl-0.5">Rows Filled</span>
                    <span className="text-3xl font-semibold font-outfit text-slate-800 dark:text-white mt-2 font-mono">
                      {sessionMetrics.filled}
                    </span>
                  </div>
                </div>

                {/* Danger: Failed */}
                <div className="bg-gradient-to-br from-rose-500/20 to-transparent p-[1px] rounded-2xl">
                  <div className="bg-white dark:bg-fp-card-dark h-full rounded-2xl p-5 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-rose-550 dark:text-rose-450 uppercase tracking-widest pl-0.5">Rows Failed</span>
                    <span className="text-3xl font-semibold font-outfit text-slate-800 dark:text-white mt-2 font-mono">
                      {sessionMetrics.failed}
                    </span>
                  </div>
                </div>

                {/* Warning: Warnings */}
                <div className="bg-gradient-to-br from-amber-500/20 to-transparent p-[1px] rounded-2xl">
                  <div className="bg-white dark:bg-fp-card-dark h-full rounded-2xl p-5 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-amber-500 dark:text-amber-450 uppercase tracking-widest pl-0.5 font-sans">Warnings</span>
                    <span className="text-3xl font-semibold font-outfit text-slate-800 dark:text-white mt-2 font-mono">
                      {sessionMetrics.warnings}
                    </span>
                  </div>
                </div>

                {/* Default: Total */}
                <div className="bg-gradient-to-br from-slate-500/20 to-transparent p-[1px] rounded-2xl">
                  <div className="bg-white dark:bg-fp-card-dark h-full rounded-2xl p-5 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-0.5">Total Rows</span>
                    <span className="text-3xl font-semibold font-outfit text-slate-800 dark:text-white mt-2 font-mono">
                      {sessionMetrics.total}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-16 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-card bg-white dark:bg-fp-card-dark flex flex-col items-center justify-center gap-3 shadow-sm">
                <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No Runs Stored</h4>
                  <p className="text-xs text-slate-400">Launch this workflow from the home tab to capture execution logs.</p>
                </div>
              </div>
            )}
          </div>

          {/* Logs Split Pane (only visible when we have a selected session) */}
          {selectedSessionId && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch flex-1 min-h-0">
              
              {/* Left Pane: Logs Stream & Filtering */}
              <div className="lg:col-span-5 flex flex-col gap-4 min-h-0 h-full">
                
                {/* Search bar */}
                <div className="relative shrink-0">
                  <input
                    type="text"
                    placeholder="Search by selector, value, errors..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-3 text-xs border rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-fp-accent dark:focus:border-white transition pl-10"
                  />
                  <div className="absolute left-3.5 top-3.5 text-slate-400 dark:text-slate-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>

                {/* Category tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none shrink-0">
                  <button
                    onClick={() => setFilter('ALL')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold font-label whitespace-nowrap active:scale-95 transition-all duration-150 ${
                      filter === 'ALL' 
                        ? 'bg-fp-accent dark:bg-white text-white dark:text-fp-sidebar' 
                        : 'bg-slate-100 dark:bg-slate-905 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                    }`}
                  >
                    ALL
                  </button>
                  <button
                    onClick={() => setFilter('FILLED')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold font-label whitespace-nowrap active:scale-95 transition-all duration-150 ${
                      filter === 'FILLED' 
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 border border-emerald-500/20' 
                        : 'bg-slate-100 dark:bg-slate-905 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                    }`}
                  >
                    FILLED
                  </button>
                  <button
                    onClick={() => setFilter('WARN')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold font-label whitespace-nowrap active:scale-95 transition-all duration-150 ${
                      filter === 'WARN' 
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-450 border border-amber-500/20' 
                        : 'bg-slate-100 dark:bg-slate-905 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                    }`}
                  >
                    WARNINGS
                  </button>
                  <button
                    onClick={() => setFilter('FAILED')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold font-label whitespace-nowrap active:scale-95 transition-all duration-150 ${
                      filter === 'FAILED' 
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-450 border border-rose-500/20' 
                        : 'bg-slate-100 dark:bg-slate-905 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                    }`}
                  >
                    FAILED
                  </button>
                </div>

                {/* List Scroll pane */}
                <div className="flex-1 overflow-y-auto no-scrollbar pr-2 space-y-3 min-h-0">
                  {filteredLogs.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-card bg-white dark:bg-fp-card-dark">
                      No logs matching filters found.
                    </div>
                  ) : (
                    filteredLogs.map((log) => {
                      const isSelected = selectedLog?.id === log.id;
                      return (
                        <div
                          key={log.id}
                          onClick={() => setSelectedLog(log)}
                          className={`p-4 rounded-card border-2 transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
                            isSelected 
                              ? 'bg-white dark:bg-fp-card-dark shadow border-fp-accent dark:border-white/40' 
                              : 'bg-white/90 dark:bg-fp-card-dark/65 hover:bg-white dark:hover:bg-fp-card-dark border-transparent shadow-sm'
                          }`}
                        >
                          <div className="flex justify-between items-center text-[10px] font-mono">
                            <span className="font-semibold text-indigo-500 dark:text-indigo-400">Row {Math.max(1, log.rowIndex - 1)}</span>
                            <span className="text-slate-400 dark:text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>

                          <div className="flex items-center justify-between gap-2.5">
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate block font-outfit">
                                {getLogFriendlyText(log)}
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider shrink-0 ${getStatusStyle(log.status)}`}>
                              {log.status.replace('FILLED_', '')}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>

              {/* Right Pane: Step Debug inspector details */}
              <div className="lg:col-span-7 flex flex-col min-h-0 h-full overflow-y-auto no-scrollbar">
                {selectedLog ? (
                  <div className="flex-1 p-6 rounded-card bg-white dark:bg-fp-card-dark shadow-sm space-y-6">
                    
                    {/* Debug Header */}
                    <div className="flex justify-between items-start pb-4 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-widest font-mono">Event Inspector</span>
                        <h3 className="text-2xl font-headline font-semibold text-slate-900 dark:text-white tracking-wide mt-1">
                          {getLogFriendlyText(selectedLog)}
                        </h3>
                      </div>
                      <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-label flex items-center gap-2 border shrink-0 ${
                        selectedLog.status.includes('FAILED') || selectedLog.status === 'ROW_SKIPPED'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      }`}>
                        {selectedLog.status.includes('FAILED') || selectedLog.status === 'ROW_SKIPPED' ? (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>EXECUTION FAILED</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>EXECUTION SUCCESS</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Detailed Diagnostics Block */}
                    {selectedLog.error && (
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4">
                        <h4 className="text-red-800 dark:text-red-400 font-semibold text-sm mb-2 flex items-center gap-2">
                          <svg className="w-4 h-4 text-red-650 dark:text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>Error Diagnostics</span>
                        </h4>
                        <p className="font-mono text-xs text-red-750 dark:text-red-300 leading-relaxed select-text whitespace-pre-wrap">
                          {selectedLog.error}
                        </p>
                        <button className="mt-3 text-[10px] bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 px-3 py-1 rounded-md font-semibold hover:bg-red-200 dark:hover:bg-red-900/60 active:scale-95 transition-all">
                          VIEW TRACE
                        </button>
                      </div>
                    )}

                    {/* Data Details Section */}
                    <div className="space-y-6">
                      
                      {/* Target Selector path */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-0.5">DOM Query Selector</label>
                        <div className="p-4 bg-slate-50 dark:bg-[#1b1b1b] rounded-xl border border-slate-200 dark:border-[#1F1F23] relative group">
                          <code className="font-mono text-xs text-pink-600 dark:text-pink-400 break-all leading-normal select-all">
                            {selectedLog.selector}
                          </code>
                          <button 
                            onClick={() => {
                              if (selectedLog.selector) {
                                navigator.clipboard.writeText(selectedLog.selector);
                              }
                            }}
                            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Copy Selector"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Attempted Value */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-0.5">Payload Value</label>
                          <div className="p-4 bg-slate-50 dark:bg-[#1b1b1b] rounded-xl border border-slate-200 dark:border-[#1F1F23]">
                            <code className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all leading-normal">
                              {selectedLog.value !== undefined ? `"${selectedLog.value}"` : 'N/A'}
                            </code>
                          </div>
                        </div>

                        {/* Strategy */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-0.5">Injection Strategy</label>
                          <div className="p-4 bg-slate-55 dark:bg-[#1b1b1b] rounded-xl border border-slate-200 dark:border-[#1F1F23]">
                            <code className="font-mono text-xs text-blue-600 dark:text-blue-400">
                              {getStrategyName(selectedLog.selectorStrategy)}
                            </code>
                          </div>
                        </div>
                      </div>

                      {/* Timing Info */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-0.5">Execution Timing</label>
                        <div className="flex gap-4">
                          <div className="flex-1 bg-slate-50 dark:bg-[#1b1b1b] p-3 rounded-xl border border-slate-200 dark:border-[#1F1F23] flex justify-between items-center">
                            <span className="text-xs text-slate-400">Start</span>
                            <span className="font-mono text-xs text-slate-700 dark:text-slate-350">{new Date(selectedLog.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="flex-1 bg-slate-50 dark:bg-[#1b1b1b] p-3 rounded-xl border border-slate-200 dark:border-[#1F1F23] flex justify-between items-center">
                            <span className="text-xs text-slate-400">Duration</span>
                            <span className={`font-mono text-xs font-semibold ${selectedLog.duration > 3000 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-350'}`}>
                              {selectedLog.duration}ms
                            </span>
                          </div>
                        </div>
                      </div>

                    </div>

                  </div>
                ) : (
                  <div className="flex-1 border border-dashed border-slate-200 dark:border-slate-800 rounded-card p-8 bg-white/20 dark:bg-slate-950/5 text-center flex flex-col items-center justify-center min-h-[350px] text-slate-400 dark:text-slate-500 gap-3 shadow-sm">
                    <svg className="w-10 h-10 opacity-30 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-400 block">No Log Event Selected</span>
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
