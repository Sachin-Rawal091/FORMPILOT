import React from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { LogTable } from '../components/LogTable';
import { CaptchaModal } from '../components/CaptchaModal';
import { ExecutionStatus } from '../../types';

export const RunScreen: React.FC = () => {
  const { 
    executionState, 
    recentLogs,
    pauseExecution, 
    resumeExecution, 
    abortExecution 
  } = useFormPilotStore();

  if (!executionState) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center animate-fade-in gap-3 p-4">
        <div className="w-16 h-16 border rounded-full bg-slate-900 border-slate-800 flex items-center justify-center text-slate-500 opacity-60">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-slate-300">No Active Automation</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-[240px]">
          No active form filling session was found. Start a run from the Excel mapping screen.
        </p>
      </div>
    );
  }

  const {
    currentRowIndex,
    totalRows,
    completedRows,
    failedRows,
    skippedRows,
    status
  } = executionState;

  const isRunning = status === ExecutionStatus.RUNNING;
  const isPaused = status === ExecutionStatus.PAUSED;
  const isCaptchaPaused = status === ExecutionStatus.CAPTCHA_PAUSED;
  const isComplete = status === ExecutionStatus.COMPLETE;

  return (
    <div className="flex flex-col gap-4 animate-fade-in h-[430px] relative">
      
      {/* CAPTCHA SOLVER MODAL */}
      <CaptchaModal />

      {/* 1. Header Details */}
      <div className="flex justify-between items-center bg-slate-900/40 border border-slate-800/80 p-3 rounded-2xl">
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase font-mono">Status Dashboard</span>
          <span className="text-xs font-bold text-slate-300 mt-0.5">
            {isComplete ? 'Automation Finished' : `Processing Row ${currentRowIndex + 1} of ${totalRows}`}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* 2. Progress Tracker */}
      <div className="p-3 border rounded-2xl bg-slate-900/40 border-slate-800/80 flex flex-col gap-3">
        <ProgressBar completed={completedRows} failed={failedRows} skipped={skippedRows} total={totalRows} />

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 border rounded-xl bg-slate-950 border-slate-800/60 flex flex-col">
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider font-mono">Filled</span>
            <span className="text-sm font-bold text-emerald-400 mt-0.5 font-mono">{completedRows}</span>
          </div>
          <div className="p-2 border rounded-xl bg-slate-950 border-slate-800/60 flex flex-col">
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider font-mono">Failed</span>
            <span className="text-sm font-bold text-rose-400 mt-0.5 font-mono">{failedRows}</span>
          </div>
          <div className="p-2 border rounded-xl bg-slate-950 border-slate-800/60 flex flex-col">
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider font-mono">Skipped</span>
            <span className="text-sm font-bold text-slate-400 mt-0.5 font-mono">{skippedRows}</span>
          </div>
        </div>
      </div>

      {/* 3. Steps log stream */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <h4 className="text-[10px] font-bold text-slate-400 pl-1 uppercase tracking-wider font-mono">Live Activity Stream</h4>
        <LogTable logs={recentLogs} maxHeight="h-[140px]" />
      </div>

      {/* 4. Play Control Bar */}
      <div className="p-3 border rounded-2xl bg-slate-900/40 border-slate-800/80 flex gap-2.5 items-center justify-between shadow-inner">
        <div className="flex gap-2 flex-1">
          {/* Pause Trigger */}
          {isRunning && (
            <button
              onClick={pauseExecution}
              className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl active:scale-95 transition flex items-center justify-center gap-1 shadow-md shadow-amber-600/10"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Pause
            </button>
          )}

          {/* Resume Trigger */}
          {(isPaused || isCaptchaPaused) && (
            <button
              onClick={resumeExecution}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl active:scale-95 transition flex items-center justify-center gap-1 shadow-md shadow-emerald-600/10 animate-pulse"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Resume
            </button>
          )}

          {isComplete && (
            <div className="flex-1 text-center py-2 text-xs font-bold text-slate-500 bg-slate-950 border border-slate-800 rounded-xl">
              Completed successfully!
            </div>
          )}
        </div>

        {/* Abort/Clear session trigger */}
        <button
          onClick={abortExecution}
          className="px-4 py-2 border rounded-xl border-slate-800 hover:bg-slate-900 active:scale-95 text-slate-400 hover:text-rose-400 font-semibold text-xs transition"
        >
          {isComplete ? 'Clear Session' : 'Abort'}
        </button>
      </div>
    </div>
  );
};
