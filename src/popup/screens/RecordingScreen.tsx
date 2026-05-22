import React, { useState, useEffect, useRef } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { Action } from '../../types';

export const RecordingScreen: React.FC = () => {
  const { 
    activeRecordingSteps, 
    activeRecordingUrl, 
    stopRecording 
  } = useFormPilotStore();

  const [name, setName] = useState<string>('');
  const stepsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of step stream
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeRecordingSteps.length]);

  const handleStopRecording = () => {
    // Falls back to timestamp name if blank
    let fallbackName: string;
    try {
      fallbackName = `Flow for ${new URL(activeRecordingUrl).hostname} (${new Date().toLocaleTimeString()})`;
    } catch {
      fallbackName = `Flow recorded on ${new Date().toLocaleTimeString()}`;
    }
    const finalName = name.trim() || fallbackName;
    stopRecording(finalName);
  };

  const getActionName = (action: Action) => {
    return Action[action] || 'ACTION';
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in h-[430px]">
      
      {/* 1. Pulsing Header */}
      <div className="p-3 border rounded-2xl bg-rose-950/20 border-rose-500/30 flex items-center justify-between shadow-[0_0_15px_rgba(244,63,94,0.15)]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
          </span>
          <h4 className="text-xs font-bold text-rose-300">Recording Live Actions</h4>
        </div>
        <span className="text-[10px] font-semibold text-rose-400 font-mono">
          {activeRecordingSteps.length} Steps
        </span>
      </div>

      {/* Target website banner */}
      <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[10px] text-slate-400 truncate font-mono">
        <span className="text-slate-500">Target:</span> {activeRecordingUrl}
      </div>

      {/* 2. Steps Stream */}
      <div className="flex-1 overflow-y-auto border border-slate-800/80 rounded-2xl bg-slate-900/10 p-3 flex flex-col gap-2 scrollbar-thin">
        {activeRecordingSteps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-1.5">
            <svg className="w-6 h-6 animate-spin text-slate-500 opacity-50" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-[10px] font-semibold">Awaiting DOM interactions...</span>
            <span className="text-[9px] text-slate-700 text-center leading-relaxed">
              Click or type on the target web form to register events.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeRecordingSteps.map((step, idx) => (
              <div 
                key={step.id}
                className="p-2 border rounded-xl bg-slate-900 border-slate-800/60 flex items-start gap-2.5 animate-slide-up"
              >
                {/* Index tag */}
                <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-500 text-[9px] font-mono font-bold mt-0.5">
                  {idx + 1}
                </span>

                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono text-[9px] font-bold">
                      {getActionName(step.action)}
                    </span>
                    {step.value && (
                      <span className="text-[10px] text-slate-300 truncate max-w-[150px] font-semibold">
                        "{step.value}"
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono mt-0.5 truncate max-w-[240px]">
                    {step.selector}
                  </span>
                </div>
              </div>
            ))}
            <div ref={stepsEndRef} />
          </div>
        )}
      </div>

      {/* 3. Naming and Commit Overlay */}
      <div className="p-3 border rounded-2xl bg-slate-900/40 border-slate-800/80 flex flex-col gap-2 shadow-inner">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-semibold text-slate-400 pl-1">Recording Name</label>
          <input
            type="text"
            placeholder="e.g. My Custom SaaS Registration"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2.5 py-1.5 text-xs border rounded-lg bg-slate-950 border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition"
          />
        </div>

        <button
          onClick={handleStopRecording}
          className="w-full py-2 bg-gradient-to-r from-rose-600 to-indigo-600 hover:brightness-110 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-600/15 transition active:scale-98"
        >
          Stop & Save Recording
        </button>
      </div>
    </div>
  );
};
