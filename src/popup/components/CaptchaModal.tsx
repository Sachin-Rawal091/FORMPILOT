import React, { useEffect, useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { CAPTCHA_SOLVE_TIMEOUT } from '../../shared/constants';

export const CaptchaModal: React.FC = () => {
  const { executionState, resumeExecution } = useFormPilotStore();
  const [timeLeft, setTimeLeft] = useState<number>(CAPTCHA_SOLVE_TIMEOUT / 1000);

  // Reset timer when a new CAPTCHA event triggers
  useEffect(() => {
    if (executionState?.captchaPending) {
      setTimeLeft(CAPTCHA_SOLVE_TIMEOUT / 1000);
    }
  }, [executionState?.captchaPending]);

  // Live countdown timer linked to CAPTCHA Solve Timeout (180s)
  useEffect(() => {
    if (timeLeft <= 0) return;
    
    const interval = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft]);

  if (!executionState || !executionState.captchaPending) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleFocusTab = () => {
    const tabId = executionState.tabContext;
    if (tabId && tabId !== -1) {
      chrome.tabs.update(tabId, { active: true });
    }
  };

  const percentage = (timeLeft / (CAPTCHA_SOLVE_TIMEOUT / 1000)) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-xs p-6 border rounded-2xl bg-slate-900 border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.25)] text-center animate-fade-in">
        
        {/* Pulsing warning mark */}
        <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 border rounded-full bg-red-500/10 border-red-500/20 text-red-500 animate-pulse">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h3 className="mb-2 text-lg font-bold text-slate-100">CAPTCHA Detected!</h3>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Form execution is suspended. Please solve the CAPTCHA block on the target form.
        </p>

        {/* Dynamic Countdown Timer */}
        <div className="relative flex items-center justify-center w-24 h-24 mx-auto mb-6">
          <svg className="w-full h-full transform -rotate-90">
            <circle 
              cx="48" 
              cy="48" 
              r="40" 
              className="stroke-slate-800" 
              strokeWidth="5" 
              fill="transparent" 
            />
            <circle 
              cx="48" 
              cy="48" 
              r="40" 
              className="stroke-red-500 transition-all duration-1000" 
              strokeWidth="5" 
              fill="transparent"
              strokeDasharray={251.2}
              strokeDashoffset={251.2 - (251.2 * percentage) / 100}
            />
          </svg>
          <div className="absolute text-xl font-bold tracking-wider text-red-500 font-mono">
            {formatTime(timeLeft)}
          </div>
        </div>

        {/* CTA Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleFocusTab}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-medium text-xs shadow-lg shadow-red-600/25 hover:brightness-110 active:scale-98 transition"
          >
            Focus Active Form
          </button>
          
          <button
            onClick={resumeExecution}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs active:scale-98 transition"
          >
            I've Solved It - Resume
          </button>
        </div>
        
        {timeLeft <= 0 && (
          <div className="mt-3 text-[10px] text-red-400 font-medium animate-pulse">
            Timeout imminent! Row will be skipped shortly.
          </div>
        )}
      </div>
    </div>
  );
};
