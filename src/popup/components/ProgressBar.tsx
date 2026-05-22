import React from 'react';

interface ProgressBarProps {
  completed: number;
  failed?: number;
  skipped?: number;
  total: number;
  showDetails?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  completed, 
  failed = 0,
  skipped = 0,
  total, 
  showDetails = true 
}) => {
  const processed = completed + failed + skipped;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className="w-full">
      {showDetails && (
        <div className="flex justify-between items-center mb-1.5 text-xs font-semibold text-slate-300">
          <span>Row Progression</span>
          <span className="text-indigo-400 font-mono">{percent}% <span className="text-slate-500 font-normal">({completed}/{total})</span></span>
        </div>
      )}
      
      {/* Progress Track */}
      <div className="w-full h-2.5 bg-slate-900 rounded-full border border-slate-800/80 overflow-hidden relative shadow-inner">
        <div 
          className="h-full bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
