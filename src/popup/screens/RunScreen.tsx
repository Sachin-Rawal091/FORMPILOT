import React, { useEffect, useRef } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { StatusBadge } from '../components/StatusBadge';
import { CaptchaModal } from '../components/CaptchaModal';
import { RadialProgress } from '../components/RadialProgress';
import { ExecutionStatus, Action } from '../../types';

export const RunScreen: React.FC = () => {
  const { 
    executionState, 
    recentLogs,
    pauseExecution, 
    resumeExecution, 
    abortExecution 
  } = useFormPilotStore();

  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Enforce a 100-item capped buffer in chronological order (oldest first, newest last)
  const displayedLogs = [...recentLogs].reverse().slice(-100);

  // Scroll to bottom of terminal when logs update
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [recentLogs]);

  if (!executionState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center animate-fade-in gap-4 p-8 border border-slate-200/50 dark:border-slate-800 rounded-card bg-white dark:bg-fp-card-dark shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 font-outfit">No Active Automation</h3>
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
    <div className="h-full bg-[#303030] text-slate-200 flex flex-col justify-between relative overflow-hidden font-sans">
      
      {/* Background Dot Grid */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')] opacity-60 pointer-events-none z-0" />

      {/* CAPTCHA SOLVER MODAL */}
      <CaptchaModal />

      {/* 1. Header Area */}
      <div className="relative z-10 bg-[#424443] border-b border-slate-900 px-8 py-5 flex items-center justify-between shadow-2xl shadow-slate-950/10">
        
        {/* Pulsing indigo top strip to match recording style */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500/20 via-indigo-500 to-indigo-500/20 animate-pulse" />

        <div className="flex items-center gap-5">
          {/* Logo Card [P] */}
          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center font-semibold text-2xl font-outfit text-white shadow-lg shadow-indigo-500/10 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 to-transparent opacity-50" />
            <span className="relative text-indigo-500 font-semibold">P</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold font-outfit tracking-wide text-white">
                Automation Execution
              </h2>
              <StatusBadge status={status} />
            </div>
            
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500">
              <svg className="w-3.5 h-3.5 text-slate-650" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <a href={siteUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-mono text-xs">{siteUrl}</a>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Content Split Pane */}
      <div className="flex-1 px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch relative z-10 min-h-0 overflow-hidden">
        
        {/* Left Column: Radial Progress & Stats */}
        <div className="lg:col-span-5 flex flex-col gap-6 min-h-0 overflow-hidden">
          
          {/* Radial progress card */}
          <div className="p-8 rounded-card bg-white dark:bg-fp-card-dark shadow-sm flex flex-col items-center justify-center flex-1 min-h-0 relative overflow-hidden border border-transparent dark:border-slate-800">
            <RadialProgress percentage={percent} label="Rows Filled" />
          </div>

          {/* Stats Metrics Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 rounded-card bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest pl-0.5 font-sans">Success Rows</span>
              <span className="text-3xl font-semibold font-outfit text-emerald-400 mt-2 font-mono">{completedRows}</span>
            </div>
            <div className="p-5 rounded-card bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest pl-0.5 font-sans">Failed Rows</span>
              <span className="text-3xl font-semibold font-outfit text-rose-500 mt-2 font-mono">{failedRows}</span>
            </div>
            <div className="p-5 rounded-card bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest pl-0.5 font-sans">Skipped Rows</span>
              <span className="text-3xl font-semibold font-outfit text-slate-500 mt-2 font-mono">{skippedRows}</span>
            </div>
            <div className="p-5 rounded-card bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between shadow-sm relative overflow-hidden">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest pl-0.5 font-sans">Total Rows</span>
              <span className="text-3xl font-semibold font-outfit text-white mt-2 font-mono">{totalRows}</span>
              <svg className="w-10 h-10 absolute right-3 bottom-3 opacity-5 text-white pointer-events-none" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 4.02 2 6.5v11c0 2.48 4.48 4.5 10 4.5s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2zm0 2c4.43 0 8 1.48 8 2.5S16.43 9 12 9s-8-1.48-8-2.5S7.57 4 12 4zm8 13.5c0 1.02-3.57 2.5-8 2.5s-8-1.48-8-2.5v-2.18c2.24 1.34 5.37 1.83 8 1.83s5.76-.49 8-1.83v2.18zm0-4.32c0 1.02-3.57 2.5-8 2.5s-8-1.48-8-2.5v-2.18c2.24 1.34 5.37 1.83 8 1.83s5.76-.49 8-1.83v2.18z"/>
              </svg>
            </div>
          </div>

        </div>

        {/* Right Column: Monospace Developer Terminal */}
        <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 bg-fp-sidebar border border-slate-900 dark:border-white/10 rounded-card flex flex-col shadow-sm overflow-hidden min-h-0">
            {/* Terminal Top bar */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-900 dark:border-white/10 bg-slate-900/10">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-[10px] text-slate-500 font-semibold ml-2 font-sans tracking-wide">stdout — active console</span>
              </div>
              <span className="text-[10px] text-slate-400/70 font-mono bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md font-semibold">
                Row {Math.min(currentRowIndex + 1, totalRows)}/{totalRows}
              </span>
            </div>

            {/* Terminal Body */}
            <div 
              ref={terminalContainerRef}
              className="flex-1 p-6 font-mono text-sm overflow-y-auto terminal-scroll relative bg-[#424443] text-white"
            >
              {/* Dot Grid Layer */}
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')] opacity-50 pointer-events-none" />
              
              <div className="space-y-2.5 relative z-10">
                {displayedLogs.length === 0 ? (
                  <div className="text-slate-600 italic">Connecting execution pipeline... awaiting console events...</div>
                ) : (
                  displayedLogs.map(log => {
                    const timestampStr = new Date(log.timestamp).toLocaleTimeString();
                    const actionName = getActionName(log.action);
                    const statusColor = getTerminalStatusColor(log.status);
                    
                    // Decaying opacity based on age of the log (fades out down to 0.4 over 60s)
                    const opacity = Math.max(0.4, 1 - (Date.now() - log.timestamp) / 60000);
                    
                    return (
                      <div 
                        key={log.id} 
                        className="border-b border-slate-900/60 pb-2 flex flex-col gap-1.5"
                        style={{ opacity }}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 text-slate-400">
                          <span className="text-white/40 shrink-0">[{timestampStr}]</span>
                          <span className="text-white/60 font-semibold">ROW {log.rowIndex - 1}</span>
                          <span className="text-white/30">|</span>
                          <span className="text-indigo-400 font-semibold">{actionName}</span>
                          <span className="text-white/30">|</span>
                          <span className="truncate max-w-[180px] text-white/80">
                            {log.value ? `"${log.value}"` : log.selector}
                          </span>
                          <span className="text-white/30 ml-auto font-semibold font-mono">::</span>
                          <span className={`font-semibold ${statusColor}`}>{log.status}</span>
                        </div>
                        
                        {log.error && (
                          <div className="text-rose-500/90 pl-4 mt-0.5 leading-relaxed whitespace-pre-wrap">
                            ↳ ERROR: {log.error}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                
                {/* Blinking cursor */}
                {isRunning && (
                  <div className="flex gap-4 mt-2">
                    <span className="text-white/30 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <div className="w-2 h-4 bg-white/80 animate-pulse" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 3. Sticky Bottom Control Console */}
      <div className="p-8 border-t border-slate-900 bg-[#424443]/80 backdrop-blur-xl relative z-10 flex justify-center items-center">
        <div className="w-full max-w-4xl flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Queue status indicators */}
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest font-mono">Queue Status</span>
            <div className="flex items-center gap-2 pl-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse animate-duration-1000" />
              <span className="text-slate-200">
                {isComplete ? 'Finished successfully' : `Processing row ${currentRowIndex + 1}...`}
              </span>
            </div>
          </div>

          {/* Action triggers */}
          <div className="flex gap-3 w-full md:w-auto shrink-0 justify-end">
            
            {/* Abort button */}
            <button
              onClick={abortExecution}
              className="px-6 py-3 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white font-semibold text-xs rounded-full transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{isComplete ? 'Clear Session' : 'Abort Auto-Fill'}</span>
            </button>

            {/* Play/Pause buttons */}
            {isRunning && (
              <button
                onClick={pauseExecution}
                className="w-36 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs uppercase tracking-wider rounded-full shadow-lg shadow-amber-500/25 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>Pause Run</span>
              </button>
            )}

            {(isPaused || isCaptchaPaused) && (
              <button
                onClick={resumeExecution}
                className="w-36 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs uppercase tracking-wider rounded-full shadow-lg shadow-emerald-500/25 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                <span>Resume Run</span>
              </button>
            )}

          </div>

        </div>
      </div>

    </div>
  );
};
