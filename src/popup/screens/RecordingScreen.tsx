import React, { useState, useEffect, useRef } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { Action, Step } from '../../types';

export const RecordingScreen: React.FC = () => {
  const { 
    activeRecordingSteps, 
    activeRecordingUrl, 
    stopRecording 
  } = useFormPilotStore();

  const [name, setName] = useState<string>('');
  const stepsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of step stream
  useEffect(() => {
    if (stepsContainerRef.current) {
      stepsContainerRef.current.scrollTop = stepsContainerRef.current.scrollHeight;
    }
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

  const getStepFriendlyName = (step: Step) => {
    const meta = step.selectorMeta;
    
    // Find friendly label name
    let friendlyName = '';
    if (meta) {
      friendlyName = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || '';
    }
    
    friendlyName = friendlyName.trim().replace(/\s+/g, ' ');

    if (!friendlyName) {
      // Fallback: If no friendly label name, clean up CSS/XPath selector slightly
      friendlyName = step.selector;
    }

    if ((step.action === Action.FILL || step.action === Action.SELECT || step.action === Action.SELECT_RADIO) && step.value) {
      return `"${step.value}"`;
    }
    
    return friendlyName;
  };

  const getActionBadge = (action: Action, idx: number) => {
    const num = idx + 1;
    switch (action) {
      case Action.FILL:
      case Action.RICH_TEXT:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            #{num} FILL
          </span>
        );
      case Action.CLICK:
      case Action.SUBMIT:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
            #{num} CLICK
          </span>
        );
      case Action.SELECT:
      case Action.SELECT_RADIO:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
            #{num} SELECT
          </span>
        );
      case Action.TOGGLE_CHECKBOX:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono bg-pink-500/10 text-pink-400 border border-pink-500/20">
            #{num} CHECKBOX
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono bg-slate-500/10 text-slate-400 border border-slate-500/20">
            #{num} ACTION
          </span>
        );
    }
  };

  const getActionIcon = (action: Action) => {
    switch (action) {
      case Action.FILL:
      case Action.RICH_TEXT:
        return (
          <svg className="w-4 h-4 text-emerald-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        );
      case Action.CLICK:
      case Action.SUBMIT:
        return (
          <svg className="w-4 h-4 text-blue-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
        );
      case Action.SELECT:
      case Action.SELECT_RADIO:
        return (
          <svg className="w-4 h-4 text-purple-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        );
      case Action.TOGGLE_CHECKBOX:
        return (
          <svg className="w-4 h-4 text-pink-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-slate-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#303030] text-slate-200 flex flex-col items-stretch justify-between relative overflow-hidden font-sans">
      
      {/* Background Dot Grid */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')] opacity-60 pointer-events-none z-0" />

      {/* 1. Header Area */}
      <div className="relative z-10">
        {/* Pulsing Black Bar */}
        <div className="bg-[#424443] border-b border-slate-900 px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* White/Red Brand P Box */}
            <div className="w-8 h-8 rounded-lg bg-red-650 flex items-center justify-center text-white font-semibold text-sm select-none shadow-[0_0_15px_rgba(220,38,38,0.25)] border border-red-500/20">
              P
            </div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <h4 className="text-xs font-semibold text-red-500 font-headline uppercase tracking-wider">Recording Live Actions</h4>
            </div>
          </div>
          <span className="text-xs font-semibold text-slate-400 font-mono tracking-wide">
            {activeRecordingSteps.length} Steps
          </span>
        </div>

        {/* Target URL Centered Sub-Header */}
        <div className="bg-slate-950/40 border-b border-slate-900/60 py-2.5 text-center text-[10px] text-slate-400 truncate font-mono">
          <span className="text-slate-500">Target:</span> {activeRecordingUrl}
        </div>
      </div>

      {/* 2. Steps Stream Container */}
      <div 
        ref={stepsContainerRef}
        className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4 relative z-10 scrollbar-thin max-h-[calc(100vh-200px)]"
      >
        {activeRecordingSteps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 py-16">
            <svg className="w-8 h-8 animate-spin text-slate-600 opacity-55" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Awaiting DOM interactions...</span>
            <span className="text-xs text-slate-500 text-center leading-relaxed px-4 max-w-sm">
              Click or type on the target web form in your browser window to capture live action steps.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-4xl mx-auto w-full">
            {activeRecordingSteps.map((step, idx) => {
              const friendlyName = getStepFriendlyName(step);
              return (
                <div 
                  key={step.id}
                  className="p-5 border rounded-2xl bg-white/[0.02] dark:bg-[#303030]/40 border-slate-200/5 dark:border-slate-800/40 flex items-center justify-between animate-slide-up shadow-sm group hover:border-slate-700/40 transition-all duration-200"
                >
                  <div className="flex flex-col min-w-0 gap-1.5">
                    <div className="flex items-center gap-3">
                      {/* Step index and action tag wrapper */}
                      {getActionBadge(step.action, idx)}
                      <span className="text-sm font-semibold text-slate-100 group-hover:text-white transition">
                        {friendlyName}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono pl-0.5 truncate max-w-lg">
                      {step.selector}
                    </span>
                  </div>

                  {/* Right hand side context icon */}
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-850/50">
                    {getActionIcon(step.action)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Integrated Bottom Commit Console Overlay */}
      <div className="p-8 border-t border-slate-900 bg-[#424443]/80 backdrop-blur-xl relative z-10 flex justify-center items-center">
        <div className="w-full max-w-4xl flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Naming Input Box */}
          <div className="w-full md:flex-1 relative">
            <input
              type="text"
              placeholder="e.g. My Custom SaaS Registration"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-5 py-3.5 text-xs border rounded-xl bg-slate-950/80 border-slate-850 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/50 transition-all font-mono font-medium"
            />
          </div>

          {/* Action Trigger button */}
          <button
            onClick={handleStopRecording}
            className="w-full md:w-auto px-8 py-3.5 bg-gradient-to-r from-red-600 to-rose-600 hover:brightness-110 text-white font-semibold text-xs uppercase tracking-widest rounded-full shadow-lg shadow-red-600/25 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2.5 shrink-0"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            <span>Stop & Save Recording</span>
          </button>

        </div>
      </div>

    </div>
  );
};
