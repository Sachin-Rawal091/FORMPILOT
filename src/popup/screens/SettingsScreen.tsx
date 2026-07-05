import React, { useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { getDB } from '../../storage/db';
import { logger } from '../../utils/logger';

export const SettingsScreen: React.FC = () => {
  const { settings, updateSettings, setTheme } = useFormPilotStore();
  const [showWipeModal, setShowWipeModal] = useState<boolean>(false);
  const [confirmText, setConfirmText] = useState<string>('');
  const [wipeStatus, setWipeStatus] = useState<string>('');

  const currentTheme = settings.theme || 'dark';

  const handleSliderChange = (key: string, value: number) => {
    updateSettings({ [key]: value });
  };

  const handleWipeDatabase = async () => {
    if (confirmText !== 'WIPE') {
      return;
    }
    
    setWipeStatus('Wiping databases...');
    try {
      // 1. Wipe all IndexedDB object stores
      const db = await getDB();
      const stores = ['recordings', 'excelData', 'logs', 'sessions', 'files'];
      const tx = db.transaction(stores, 'readwrite');
      await Promise.all(stores.map(store => tx.objectStore(store).clear()));
      await tx.done;

      // 2. Clear state in Zustand Store
      useFormPilotStore.setState({
        recordings: [],
        selectedRecording: null,
        excelData: [],
        excelRowCount: 0,
        excelHeaders: [],
        fuzzyMapping: {},
        executionState: null,
        recentLogs: []
      });

      setWipeStatus('Database wiped successfully.');
      setTimeout(() => {
        setShowWipeModal(false);
        setConfirmText('');
        setWipeStatus('');
      }, 1500);
    } catch (err: any) {
      logger.error('SettingsScreen', 'Database wipe failed:', err);
      setWipeStatus(`Failed to wipe: ${err.message || err}`);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Title block */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold font-outfit tracking-wide text-slate-900 dark:text-white">
          Configuration Settings
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
          Adjust step execution delays, element timeouts, and system log configurations to tune automation performance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Grid: Custom Settings Sliders */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-card bg-white dark:bg-fp-card-dark shadow-sm space-y-6">
            <h3 className="text-base font-semibold font-outfit text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-850 pb-3">
              Execution Control Limits
            </h3>

            {/* Slider 1: Step Delay */}
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Step Execution Delay</span>
                <span className="font-mono font-semibold text-fp-accent dark:text-white bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">
                  {settings.stepDelay} ms
                </span>
              </div>
              <input
                type="range"
                min="100"
                max="5000"
                step="100"
                value={settings.stepDelay || 1000}
                onChange={(e) => handleSliderChange('stepDelay', parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fp-accent dark:accent-white"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed pl-0.5">
                Delay time between simulated user interaction steps (e.g. key strokes, options select, button clicks) to prevent race conditions.
              </p>
            </div>

            {/* Slider 2: Wait Element Timeout */}
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">DOM Stability Element Timeout</span>
                <span className="font-mono font-semibold text-fp-accent dark:text-white bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">
                  {Math.round((settings.waitElementTimeout || 10000) / 1000)} seconds
                </span>
              </div>
              <input
                type="range"
                min="1000"
                max="30000"
                step="550"
                value={settings.waitElementTimeout || 10000}
                onChange={(e) => handleSliderChange('waitElementTimeout', parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fp-accent dark:accent-white"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed pl-0.5">
                Maximum time allowed for a dynamic React/Vue web element to render and stabilize on the page before a step fails.
              </p>
            </div>

            {/* Slider 3: Max Step Retries */}
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Max Stability Step Retries</span>
                <span className="font-mono font-semibold text-fp-accent dark:text-white bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">
                  {settings.maxStepRetries} attempts
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={settings.maxStepRetries === undefined ? 3 : settings.maxStepRetries}
                onChange={(e) => handleSliderChange('maxStepRetries', parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fp-accent dark:accent-white"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed pl-0.5">
                Number of recovery retries attempted if the target selector fails due to an unexpected overlay or stability exception.
              </p>
            </div>
          </div>

          <div className="p-6 rounded-card bg-white dark:bg-fp-card-dark shadow-sm space-y-6">
            <h3 className="text-base font-semibold font-outfit text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-850 pb-3">
              Diagnostic Logs Configuration
            </h3>

            {/* Input 1: Log Max Entries */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Capped Log Entries Buffer</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-normal">
                  Maximum entries saved per logging session.
                </span>
              </div>
              <input
                type="number"
                min="50"
                max="10000"
                step="50"
                value={settings.logMaxEntries || 1000}
                onChange={(e) => handleSliderChange('logMaxEntries', parseInt(e.target.value) || 1000)}
                className="w-full sm:w-36 px-4 py-2.5 border rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-850 text-slate-800 dark:text-slate-200 text-xs font-semibold font-mono focus:outline-none focus:border-fp-accent dark:focus:border-white"
              />
            </div>

            {/* Input 2: Log Retention Days */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Retention Period</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-normal">
                  Auto-clean diagnostic logs older than this duration.
                </span>
              </div>
              <input
                type="number"
                min="1"
                max="120"
                step="1"
                value={settings.logRetentionDays || 30}
                onChange={(e) => handleSliderChange('logRetentionDays', parseInt(e.target.value) || 30)}
                className="w-full sm:w-36 px-4 py-2.5 border rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-855 text-slate-800 dark:text-slate-200 text-xs font-semibold font-mono focus:outline-none focus:border-fp-accent dark:focus:border-white"
              />
            </div>
          </div>
        </div>

        {/* Right Grid: Theme & Database Administration */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Theme Settings Card */}
          <div className="p-6 rounded-card bg-white dark:bg-fp-card-dark shadow-sm space-y-4">
            <h3 className="text-base font-semibold font-outfit text-slate-800 dark:text-slate-200">
              Appearance Theme
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed mb-4">
              Select between light and dark visual aesthetics for FormPilot dashboard panels.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTheme('light')}
                className={`py-3 px-4 border rounded-xl flex items-center justify-center gap-2 font-semibold text-xs active:scale-95 transition-all duration-200 ${
                  currentTheme === 'light'
                    ? 'border-fp-accent bg-slate-100/50 text-fp-sidebar dark:border-white dark:text-white dark:bg-white/10 shadow-sm'
                    : 'border-slate-205 hover:border-slate-300 dark:border-slate-800/80 dark:hover:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                <span>Light</span>
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={`py-3 px-4 border rounded-xl flex items-center justify-center gap-2 font-semibold text-xs active:scale-95 transition-all duration-200 ${
                  currentTheme === 'dark'
                    ? 'border-fp-accent bg-slate-100/50 text-fp-sidebar dark:border-white dark:text-white dark:bg-white/10 shadow-sm'
                    : 'border-slate-205 hover:border-slate-300 dark:border-slate-800/80 dark:hover:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span>Dark</span>
              </button>
            </div>
          </div>

          {/* Database Admin Card */}
          <div className="p-6 rounded-card bg-white dark:bg-fp-card-dark shadow-sm space-y-4">
            <h3 className="text-base font-semibold font-outfit text-slate-800 dark:text-slate-200">
              Database Maintenance
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Flush and clear cached execution logs, recordings list, and worksheet schemas.
            </p>

            <button
              onClick={() => setShowWipeModal(true)}
              className="w-full py-3 rounded-full bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 hover:border-transparent font-semibold text-xs transition active:scale-95 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Wipe Extension Databases</span>
            </button>
          </div>

        </div>

      </div>

      {/* Confirmation Wipe Dialog Modal */}
      {showWipeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-rose-500/20 rounded-card bg-white dark:bg-fp-card-dark p-6 space-y-6 shadow-2xl animate-fade-in text-slate-950 dark:text-slate-100">
            <div className="space-y-2">
              <h4 className="text-base font-semibold font-outfit text-rose-600 dark:text-rose-500 flex items-center gap-2">
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.008v.008H12V16.5zm-7.5 3h15L12 4.5 4.5 19.5z" />
                </svg>
                <span>Critical Database Wipe Action</span>
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                This will completely wipe all saved workflows, column mapping data, logs history, and cache. This action cannot be undone.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest pl-0.5 font-sans">
                Type "WIPE" to authorize
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="e.g. WIPE"
                className="w-full px-4 py-3 text-xs border-2 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-850 font-semibold font-mono text-center tracking-widest focus:outline-none focus:border-rose-500 uppercase text-slate-800 dark:text-slate-200"
              />
            </div>

            {wipeStatus && (
              <div className="text-xs text-center font-semibold text-slate-600 dark:text-indigo-400 font-mono">
                {wipeStatus}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowWipeModal(false);
                  setConfirmText('');
                  setWipeStatus('');
                }}
                className="flex-1 py-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-full hover:bg-slate-200 active:scale-95 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleWipeDatabase}
                disabled={confirmText !== 'WIPE'}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-semibold text-xs rounded-full shadow-lg shadow-rose-600/10 active:scale-95 transition"
              >
                Authorize Wipe
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
