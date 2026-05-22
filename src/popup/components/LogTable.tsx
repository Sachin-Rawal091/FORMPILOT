import React from 'react';
import { LogEntry, Action } from '../../types';

interface LogTableProps {
  logs: LogEntry[];
  maxHeight?: string;
}

export const LogTable: React.FC<LogTableProps> = ({ logs, maxHeight = 'h-[280px]' }) => {
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'FILLED':
      case 'SUCCESS':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'FILLED_DEFAULT':
      case 'FILLED_COERCED':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      case 'STEP_SKIPPED':
        return 'text-slate-400 bg-slate-800 border-slate-700';
      case 'WARN':
      case 'RETRIED':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'ROW_SKIPPED':
      case 'CAPTCHA_DETECTED':
      case 'FAILED':
      default:
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    }
  };

  const getActionName = (action: Action) => {
    return Action[action] || 'ACTION';
  };

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 border border-slate-800/80 rounded-xl bg-slate-900/40 text-slate-500">
        <svg className="w-8 h-8 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs">No execution events yet</span>
      </div>
    );
  }

  return (
    <div className={`w-full overflow-y-auto pr-1 ${maxHeight} scrollbar-thin`}>
      <div className="flex flex-col gap-2">
        {logs.map((log) => (
          <div 
            key={log.id} 
            className="p-3 border rounded-xl bg-slate-900/60 border-slate-800/50 hover:bg-slate-900 hover:border-slate-800 transition flex flex-col gap-1.5"
          >
            {/* Log Header */}
            <div className="flex justify-between items-center text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-400 font-mono">Row {log.rowIndex}</span>
                <span className="text-slate-600 font-bold">•</span>
                <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-md border font-semibold text-[9px] ${getStatusStyle(log.status)}`}>
                {log.status}
              </span>
            </div>

            {/* Action and target */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono text-[9px] font-bold">
                    {getActionName(log.action)}
                  </span>
                  {log.value && (
                    <span className="text-xs font-semibold text-slate-300 truncate max-w-[150px]">
                      "{log.value}"
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 font-mono truncate max-w-[280px]">
                  {log.selector}
                </span>
              </div>

              {log.retryCount > 0 && (
                <span className="text-[9px] text-amber-500 bg-amber-500/5 border border-amber-500/10 px-1 py-0.5 rounded font-mono">
                  Retry {log.retryCount}
                </span>
              )}
            </div>

            {/* Error or recovery report */}
            {log.error && (
              <div className="text-[10px] text-rose-400/90 font-mono px-2 py-1 rounded bg-rose-500/5 border border-rose-500/10 leading-relaxed break-words">
                {log.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
