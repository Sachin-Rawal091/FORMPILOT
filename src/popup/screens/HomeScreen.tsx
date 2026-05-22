import React, { useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';

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

  // Mutex check: is there another active session?
  const isMutexLocked = executionState !== null && executionState.mutexLock !== null;

  const handleStartRecording = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    // Direct url validation
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
    // Redirect to data upload/mapping
    setActiveTab('data');
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      
      {/* 1. Active Automation Mutex Block */}
      {isMutexLocked && (
        <div className="p-4 border rounded-2xl bg-violet-950/20 border-violet-500/30 shadow-[0_0_15px_rgba(139,92,246,0.15)] flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <span className="relative flex h-3 w-3 mt-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500"></span>
            </span>
            <div className="flex flex-col min-w-0">
              <h4 className="text-xs font-bold text-violet-300">Active Run in Progress</h4>
              <p className="text-[10px] text-violet-400/90 leading-relaxed mt-0.5">
                FormPilot is currently processing an Excel sheet. Mutex controls are locked.
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('run')}
              className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-[10px] active:scale-98 transition text-center"
            >
              View Progression
            </button>
            <button
              onClick={abortExecution}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-rose-400 font-medium text-[10px] active:scale-98 transition text-center"
            >
              Force Abort
            </button>
          </div>
        </div>
      )}

      {/* 2. Recorder Console */}
      <div className={`p-4 border rounded-2xl bg-slate-900/40 border-slate-800/80 shadow-md ${isMutexLocked ? 'opacity-40 pointer-events-none' : ''}`}>
        <h3 className="text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
          Record Automation Flow
        </h3>
        <p className="text-[10px] text-slate-500 mb-3">
          Enter a web address to start recording your form interactions.
        </p>

        <form onSubmit={handleStartRecording} className="flex flex-col gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="e.g. google.com or https://myform.org"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isMutexLocked}
              className="w-full px-3 py-2 text-xs border rounded-xl bg-slate-950 border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition pr-8"
            />
            <button
              type="submit"
              disabled={isMutexLocked || !url.trim()}
              className="absolute right-1 top-1 bottom-1 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[10px] active:scale-95 transition disabled:opacity-40 disabled:hover:bg-indigo-600 flex items-center justify-center"
            >
              Record
            </button>
          </div>
          {errorMsg && (
            <span className="text-[9px] text-rose-400 font-medium ml-1">
              {errorMsg}
            </span>
          )}
        </form>
      </div>

      {/* 3. Recordings List */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2">
          <span>Saved Automation Flows</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-[9px] font-mono text-slate-500">
            {recordings.length}
          </span>
        </h3>

        {recordings.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-800/80 rounded-2xl text-center text-slate-600 flex flex-col items-center justify-center">
            <svg className="w-8 h-8 mb-2 opacity-25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs font-medium">No recorded flows found</span>
            <span className="text-[10px] opacity-75 mt-0.5">Use the console above to record your first flow.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
            {recordings.map((rec) => {
              const isSelected = selectedRecording?.id === rec.id;
              
              return (
                <div 
                  key={rec.id} 
                  className={`p-3 border rounded-2xl transition flex flex-col gap-2 hover:bg-slate-900/50 ${isSelected ? 'border-indigo-500/50 bg-slate-900/35' : 'border-slate-800/60 bg-slate-900/10'}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-col min-w-0" onClick={() => setSelectedRecording(rec)}>
                      <h4 className="text-xs font-bold text-slate-200 truncate cursor-pointer hover:text-indigo-400 transition">
                        {rec.name}
                      </h4>
                      <span className="text-[9px] text-slate-500 font-mono truncate max-w-[200px] mt-0.5">
                        {rec.siteUrl}
                      </span>
                    </div>

                    <button
                      onClick={() => deleteRecording(rec.id)}
                      disabled={isMutexLocked}
                      className="p-1 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* Flow Metadata & Map Trigger */}
                  <div className="flex justify-between items-center text-[9px] mt-1 pt-2 border-t border-slate-800/40">
                    <div className="flex items-center gap-2 text-slate-500 font-mono">
                      <span>{rec.steps.length} steps</span>
                      <span>•</span>
                      <span>{new Date(rec.createdAt).toLocaleDateString()}</span>
                    </div>

                    <button
                      onClick={() => handleSelectToMap(rec)}
                      disabled={isMutexLocked}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-600 hover:text-white font-semibold transition active:scale-95 flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <span>Upload Data</span>
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    </div>
  );
};
