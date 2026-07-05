import React from 'react';

interface RadialProgressProps {
  percentage: number; // 0 to 100
  label?: string;     // e.g. "Rows Filled"
}

export const RadialProgress: React.FC<RadialProgressProps> = ({
  percentage,
  label = 'Rows Filled'
}) => {
  const cleanPercentage = Math.min(Math.max(percentage, 0), 100);
  const radius = 40;
  const circumference = 2 * Math.PI * radius; // 251.327
  const offset = circumference - (cleanPercentage / 100) * circumference;

  return (
    <div className="relative w-64 h-64 flex items-center justify-center select-none">
      <svg className="w-full h-full" viewBox="0 0 100 100">
        {/* Background track */}
        <circle 
          cx="50" 
          cy="50" 
          r={radius} 
          className="text-slate-100 dark:text-white/5 stroke-current" 
          strokeWidth="8"
          fill="transparent"
        />
        {/* Progress arc */}
        <circle 
          cx="50" 
          cy="50" 
          r={radius} 
          className="text-fp-accent dark:text-white stroke-current transition-all duration-500 ease-out" 
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-6xl font-headline font-semibold text-slate-900 dark:text-white tabular-nums tracking-tighter">
          {Math.round(cleanPercentage)}
          <span className="text-4xl text-slate-400 dark:text-white/50 font-semibold">%</span>
        </span>
        <span className="font-label font-semibold text-xs uppercase tracking-widest text-slate-400 dark:text-white/50 mt-1">
          {label}
        </span>
      </div>
    </div>
  );
};
