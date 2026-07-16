import React from 'react';
import { ExecutionStatus } from '../../types';

interface StatusBadgeProps {
  status: ExecutionStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getBadgeStyles = () => {
    switch (status) {
      case ExecutionStatus.STARTING:
        return {
          bg: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
          label: 'STARTING...',
          pulse: true,
          pulseColor: 'bg-indigo-400'
        };
      case ExecutionStatus.RUNNING:
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          label: 'RUNNING',
          pulse: true,
          pulseColor: 'bg-emerald-400'
        };
      case ExecutionStatus.PAUSED:
        return {
          bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          label: 'PAUSED',
          pulse: false,
          pulseColor: ''
        };
      case ExecutionStatus.CAPTCHA_PAUSED:
        return {
          bg: 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.15)]',
          label: 'CAPTCHA PAUSE',
          pulse: true,
          pulseColor: 'bg-rose-500'
        };
      case ExecutionStatus.COMPLETE:
        return {
          bg: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
          label: 'COMPLETED',
          pulse: false,
          pulseColor: ''
        };
      case ExecutionStatus.FAILED:
        return {
          bg: 'bg-red-500/10 border-red-500/30 text-red-400',
          label: 'FAILED',
          pulse: false,
          pulseColor: ''
        };
      case ExecutionStatus.IDLE:
      default:
        return {
          bg: 'bg-slate-800 border-slate-700 text-slate-400',
          label: 'READY / IDLE',
          pulse: false,
          pulseColor: ''
        };
    }
  };

  const config = getBadgeStyles();

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-wider ${config.bg}`}>
      {config.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.pulseColor}`}></span>
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${config.pulseColor}`}></span>
        </span>
      )}
      {config.label}
    </span>
  );
};
