import React, { useEffect, useRef } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { StatusBadge } from '../components/StatusBadge';
import { CaptchaModal } from '../components/CaptchaModal';
import { ExecutionStatus, Action } from '../../types';

export const RunScreen: React.FC = () => {
  const { 
    executionState, 
    recentLogs,
    pauseExecution, 
    resumeExecution, 
    abortExecution 
  } = useFormPilotStore();

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Enforce a 100-item capped buffer for rendering and reverse to show chronologically
  const displayedLogs = recentLogs.slice(0, 100).reverse();

  // Scroll to bottom of terminal when logs update
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [recentLogs]);

  if (!executionState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center animate-fade-in gap-4 p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/40 dark:bg-slate-950/5">
        <div className="w-16 h-16 border rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 font-outfit">No Active Automation</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            No active form filling session was found. Start a run from the Excel mapping screen.
          </p>
        </div>
      </div>
    );
  }

  const {
    currentRowIndex,
    totalRows,
    completedRows,
    failedRows,
    skippedRows,
    status,
    siteUrl
  } = executionState;

  const isRunning = status === ExecutionStatus.RUNNING;
  const isPaused = status === ExecutionStatus.PAUSED;
  const isCaptchaPaused = status === ExecutionStatus.CAPTCHA_PAUSED;
  const isComplete = status === ExecutionStatus.COMPLETE;

  // Circular progress calculations
  const totalProcessed = completedRows + failedRows + skippedRows;
  const percent = totalRows > 0 ? Math.round((totalProcessed / totalRows) * 100) : 0;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const getActionName = (action: Action) => {
    return Action[action] || 'ACTION';
  };

  const getTerminalStatusColor = (logStatus: string) => {
    switch (logStatus) {
      case 'FILLED':
      case 'SUCCESS':
        return 'text-emerald-400';
      case 'FILLED_DEFAULT':
      case 'FILLED_COERCED':
        return 'text-cyan-400';
      case 'STEP_SKIPPED':
        return 'text-slate-500';
      case 'WARN':
      case 'RETRIED':
        return 'text-amber-400';
      case 'ROW_SKIPPED':
      case 'CAPTCHA_DETECTED':
      case 'FAILED':
      default:
        return 'text-rose-500';
    }
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      
      {/* CAPTCHA SOLVER MODAL */}
      <CaptchaModal />

      {/* Title & Status Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-black font-outfit tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 dark:from-white dark:via-indigo-200 dark:to-white">
            Automation Execution
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl truncate">
            Target Page: <a href={siteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">{siteUrl}</a>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Left Column: Radial Progress & Stats */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Radial progress card */}
          <div className="p-6 border-2 rounded-2xl bg-white dark:bg-slate-950/20 border-slate-200 dark:border-slate-800/80 shadow-[0_0_20px_rgba(0,0,0,0.01)] flex flex-col items-center justify-center min-h-[250px] relative">
            <div className="relative w-40 h-40 flex items-center justify-center">
              {/* SVG circular track */}
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  className="stroke-slate-100 dark:stroke-slate-800"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  className="stroke-indigo-600 dark:stroke-indigo-500 transition-all duration-500 ease-out"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              {/* Text inside */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black font-outfit text-slate-800 dark:text-white leading-none">
                  {percent}%
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold mt-1">
                  Rows Filled
                </span>
              </div>
            </div>
          </div>

          {/* Stats Metrics Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border-2 rounded-2xl bg-white dark:bg-slate-950/10 border-slate-200 dark:border-slate-800/80 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Success Rows</span>
              <span className="text-2xl font-black font-outfit text-emerald-600 dark:text-emerald-400 mt-1 font-mono">{completedRows}</span>
            </div>
            <div className="p-4 border-2 rounded-2xl bg-white dark:bg-slate-950/10 border-slate-200 dark:border-slate-800/80 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Failed Rows</span>
              <span className="text-2xl font-black font-outfit text-rose-500 dark:text-rose-400 mt-1 font-mono">{failedRows}</span>
            </div>
            <div className="p-4 border-2 rounded-2xl bg-white dark:bg-slate-950/10 border-slate-200 dark:border-slate-800/80 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Skipped Rows</span>
              <span className="text-2xl font-black font-outfit text-slate-500 dark:text-slate-400 mt-1 font-mono">{skippedRows}</span>
            </div>
            <div className="p-4 border-2 rounded-2xl bg-white dark:bg-slate-950/10 border-slate-200 dark:border-slate-800/80 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">Total Rows</span>
              <span className="text-2xl font-black font-outfit text-indigo-600 dark:text-indigo-400 mt-1 font-mono">{totalRows}</span>
            </div>
          </div>

        </div>

        {/* Right Column: Monospace Developer Terminal */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="flex-1 min-h-[380px] bg-slate-950 border-2 border-slate-900 rounded-2xl p-4 font-mono text-[11px] leading-relaxed flex flex-col shadow-2xl">
            {/* Terminal Top bar */}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-slate-900">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                <span className="text-[10px] text-slate-600 font-bold ml-2">stdout — active console</span>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">Row {Math.min(currentRowIndex + 1, totalRows)}/{totalRows}</span>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2 font-mono scrollbar-thin max-h-[340px]">
              {displayedLogs.length === 0 ? (
                <div className="text-slate-600 italic">Connecting execution pipeline... awaiting console events...</div>
              ) : (
                displayedLogs.map((log) => {
                  const timestampStr = new Date(log.timestamp).toLocaleTimeString();
                  const actionName = getActionName(log.action);
                  const statusColor = getTerminalStatusColor(log.status);
                  
                  return (
                    <div key={log.id} className="border-b border-slate-900/40 pb-2">
                      <div className="flex flex-wrap items-center gap-x-2 text-slate-400">
                        <span className="text-slate-600">[{timestampStr}]</span>
                        <span className="text-indigo-400 font-bold">ROW {log.rowIndex - 1}</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-300 font-bold">{actionName}</span>
                        <span className="text-slate-600">|</span>
                        <span className="truncate max-w-[150px] dark:text-slate-200">
                          {log.value ? `"${log.value}"` : log.selector}
                        </span>
                        <span className="text-slate-600 ml-auto font-bold font-mono">::</span>
                        <span className={`font-bold ${statusColor}`}>{log.status}</span>
                      </div>
                      
                      {log.error && (
                        <div className="text-rose-500/90 pl-4 mt-1 leading-relaxed whitespace-pre-wrap">
                          ↳ ERROR: {log.error}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>

      </div>

      {/* Glassmorphic Play Controls Footer */}
      <div className="p-4 border-2 rounded-2xl bg-white/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800/80 backdrop-blur-xl flex gap-3 items-center justify-between shadow-lg">
        <div className="flex gap-3 flex-1 max-w-md">
          {/* Pause Trigger */}
          {isRunning && (
            <button
              onClick={pauseExecution}
              className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl active:scale-95 transition flex items-center justify-center gap-2 shadow-lg shadow-amber-600/10"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Pause Run</span>
            </button>
          )}

          {/* Resume Trigger */}
          {(isPaused || isCaptchaPaused) && (
            <button
              onClick={resumeExecution}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl active:scale-95 transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/10 animate-pulse"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              <span>Resume Automation</span>
            </button>
          )}

          {isComplete && (
            <div className="flex-1 text-center py-3 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Pipeline Finished Successfully</span>
            </div>
          )}
        </div>

        {/* Abort/Clear session trigger */}
        <button
          onClick={abortExecution}
          className="px-6 py-3 border-2 rounded-xl border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 active:scale-95 text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 font-bold text-xs transition-all"
        >
          {isComplete ? 'Clear Pipeline Session' : 'Abort Auto-Fill Queue'}
        </button>
      </div>

    </div>
  );
};
