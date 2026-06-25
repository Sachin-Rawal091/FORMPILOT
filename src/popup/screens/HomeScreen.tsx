import React, { useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { Action } from '../../types';

export const HomeScreen: React.FC = () => {
  const { 
    recordings, 
    selectedRecording,
    setSelectedRecording,
    startRecording, 
    deleteRecording,
    executionState,
    abortExecution,
    setActiveTab
  } = useFormPilotStore();

  const [url, setUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);

  // Mutex check: is there another active session?
  const isMutexLocked = executionState !== null && executionState.mutexLock !== null;

  const handleStartRecording = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    try {
      new URL(cleanUrl);
      setErrorMsg('');
      await startRecording(cleanUrl);
    } catch {
      setErrorMsg('Please enter a valid website URL.');
    }
  };

  const handleSelectToMap = (rec: any) => {
    setSelectedRecording(rec);
    setActiveTab('data');
  };

  const getActionBadge = (action: Action) => {
    switch (action) {
      case Action.FILL:
        return { label: 'Fill', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
      case Action.CLICK:
        return { label: 'Click', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
      case Action.SELECT:
        return { label: 'Select', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' };
      case Action.SELECT_RADIO:
        return { label: 'Radio', color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' };
      case Action.TOGGLE_CHECKBOX:
        return { label: 'Checkbox', color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' };
      case Action.WAIT:
        return { label: 'Wait', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
      case Action.SCROLL:
        return { label: 'Scroll', color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' };
      case Action.SUBMIT:
        return { label: 'Submit', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' };
      case Action.FILE_UPLOAD:
        return { label: 'Upload', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' };
      default:
        return { label: 'Action', color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' };
    }
  };

  const toggleExpandRecording = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRecordingId(expandedRecordingId === id ? null : id);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Dashboard Welcome Title */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-black font-outfit tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 dark:from-white dark:via-indigo-200 dark:to-white">
          Form Automation Hub
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
          Create resilience-based web recording automations, map custom Excel rows, and trigger automated form filling queues.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Side: Saved Automation Flows */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold font-outfit text-slate-800 dark:text-slate-200 flex items-center gap-2.5">
              <span>Saved Workflows</span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-900 border border-slate-300/40 dark:border-slate-800/60 text-xs font-bold font-mono text-slate-600 dark:text-slate-400">
                {recordings.length}
              </span>
            </h3>
          </div>

          {recordings.length === 0 ? (
            <div className="p-12 border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-2xl text-center bg-white/40 dark:bg-slate-950/20 backdrop-blur-sm flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-800 mb-4 text-slate-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">No recorded flows found</span>
              <span className="text-xs text-slate-400 mt-1 max-w-xs">
                Use the recording panel on the right to build your first resilient auto-fill sequence.
              </span>
            </div>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin">
              {recordings.map((rec) => {
                const isSelected = selectedRecording?.id === rec.id;
                const isExpanded = expandedRecordingId === rec.id;
                
                return (
                  <div 
                    key={rec.id} 
                    onClick={() => setSelectedRecording(rec)}
                    className={`border rounded-2xl transition-all duration-300 cursor-pointer overflow-hidden ${
                      isSelected 
                        ? 'border-indigo-500 bg-white dark:bg-slate-900/50 shadow-md shadow-indigo-500/5' 
                        : 'border-slate-200 dark:border-slate-800/80 bg-white/60 dark:bg-slate-950/10 hover:bg-white dark:hover:bg-slate-900/20'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                            {rec.name}
                          </h4>
                          {isSelected && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                              Active
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate block mt-0.5">
                          {rec.siteUrl}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                        <button
                          onClick={(e) => toggleExpandRecording(rec.id, e)}
                          className="p-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition active:scale-95"
                          title="Preview steps"
                        >
                          <svg className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRecording(rec.id);
                          }}
                          disabled={isMutexLocked}
                          className="p-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
                          title="Delete Workflow"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Expandable Step Preview Drawer */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-900/20">
                        <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                          Recorded Flow Timeline ({rec.steps.length} Steps)
                        </div>
                        
                        <div className="space-y-3 pl-2 border-l border-slate-200 dark:border-slate-800">
                          {rec.steps.map((step) => {
                            const badge = getActionBadge(step.action);
                            const targetLabel = step.columnName 
                              ? `Mapped to column: ${step.columnName}`
                              : step.selectorMeta?.labelText 
                                || step.selectorMeta?.placeholder 
                                || step.selectorMeta?.name 
                                || step.value 
                                || 'Element';
                            
                            return (
                              <div key={step.id} className="relative flex items-start gap-3">
                                {/* Dot Indicator */}
                                <div className="absolute -left-[12.5px] top-1.5 w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700 border border-white dark:border-slate-900" />
                                
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${badge.color} shrink-0`}>
                                  {badge.label}
                                </span>
                                
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">
                                    {targetLabel}
                                  </span>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-md mt-0.5">
                                    {step.selector}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Flow Footer & Action Triggers */}
                    <div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800/40 flex justify-between items-center text-xs font-medium">
                      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 font-mono text-[10px]">
                        <span>Created {new Date(rec.createdAt).toLocaleDateString()}</span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectToMap(rec);
                        }}
                        disabled={isMutexLocked}
                        className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition active:scale-95 flex items-center gap-1.5 shadow-md shadow-indigo-600/10 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <span>Map Spreadsheet</span>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Recorder Console & Mutex Panels */}
        <div className="lg:col-span-5 space-y-6 sticky top-8">
          
          {/* Active Mutex Lock Banner */}
          {isMutexLocked && (
            <div className="p-5 border-2 rounded-2xl bg-indigo-950/20 dark:bg-indigo-950/10 border-indigo-500/30 dark:border-indigo-500/20 shadow-[0_0_25px_rgba(99,102,241,0.15)] flex flex-col gap-4">
              <div className="flex gap-3">
                <span className="relative flex h-3 w-3 mt-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                </span>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-300">Execution Mutex Locked</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    An automation execution is currently active. To protect database state consistency and avoid collision, recording is disabled.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('run')}
                  className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs active:scale-95 transition text-center shadow-lg shadow-indigo-600/20"
                >
                  View Progression
                </button>
                <button
                  onClick={abortExecution}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-rose-500 font-bold text-xs active:scale-95 transition text-center"
                >
                  Abort Run
                </button>
              </div>
            </div>
          )}

          {/* Recording Console Panel */}
          <div className={`p-6 border-2 rounded-2xl bg-white dark:bg-slate-950/20 border-slate-200 dark:border-slate-800/80 shadow-[0_0_30px_rgba(99,102,241,0.02)] transition-all duration-300 ${
            isMutexLocked ? 'opacity-40 pointer-events-none' : 'hover:shadow-[0_0_40px_rgba(99,102,241,0.06)]'
          }`}>
            <h3 className="text-base font-bold font-outfit text-slate-800 dark:text-slate-200 mb-1.5 flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-indigo-600 dark:bg-indigo-500 rounded-full animate-pulse" />
              Record Form Flow
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed mb-5">
              Enter any URL to initiate a form recording session. We will open a target browser tab and automatically save your interactions.
            </p>

            <form onSubmit={handleStartRecording} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-1">
                  Target Website URL
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. google.com or https://myform.org"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isMutexLocked}
                    className="w-full px-4 py-3 text-xs border-2 rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500/80 focus:ring-0 transition"
                  />
                </div>
              </div>
              
              {errorMsg && (
                <div className="text-[11px] text-rose-500 font-semibold pl-1">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={isMutexLocked || !url.trim()}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs active:scale-95 transition shadow-lg shadow-indigo-600/10 disabled:opacity-40 disabled:hover:bg-indigo-600 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Launch Recording Tab</span>
              </button>
            </form>
          </div>

          {/* Quick Guide card */}
          <div className="p-6 border border-slate-200 dark:border-slate-800/80 rounded-2xl bg-white/40 dark:bg-slate-950/5">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">Quick Walkthrough</h4>
            <ul className="space-y-3.5">
              <li className="flex gap-2.5 items-start text-xs text-slate-500 dark:text-slate-400">
                <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">1</span>
                <span>Enter URL and launch. Interact with the website form normally.</span>
              </li>
              <li className="flex gap-2.5 items-start text-xs text-slate-500 dark:text-slate-400">
                <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">2</span>
                <span>Click <b>Stop</b> inside the dashboard when finished recording.</span>
              </li>
              <li className="flex gap-2.5 items-start text-xs text-slate-500 dark:text-slate-400">
                <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">3</span>
                <span>Upload Excel file containing your rows, match fields, and click run.</span>
              </li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
};
