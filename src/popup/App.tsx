import React, { useEffect } from 'react';
import { useFormPilotStore, TabType } from './store/useFormPilotStore';
import { HomeScreen } from './screens/HomeScreen';
import { RecordingScreen } from './screens/RecordingScreen';
import { DataScreen } from './screens/DataScreen';
import { RunScreen } from './screens/RunScreen';
import { LogScreen } from './screens/LogScreen';
import { ExecutionStatus } from '../types';

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab, 
    isRecording, 
    executionState, 
    initStore, 
    cleanupStoreListener 
  } = useFormPilotStore();

  // 1. Initialize store state and message observers on popup mount
  useEffect(() => {
    initStore();
    return () => {
      if (cleanupStoreListener) {
        cleanupStoreListener();
      }
    };
  }, []);

  const isExecutionActive = executionState !== null && (
    executionState.status === ExecutionStatus.RUNNING ||
    executionState.status === ExecutionStatus.PAUSED ||
    executionState.status === ExecutionStatus.CAPTCHA_PAUSED
  );

  // 2. Select appropriate component based on active navigation tab
  const renderScreen = () => {
    if (isRecording) {
      return <RecordingScreen />;
    }
    if (isExecutionActive) {
      return <RunScreen />;
    }

    switch (activeTab) {
      case 'home':
        return <HomeScreen />;
      case 'data':
        return <DataScreen />;
      case 'run':
        return <RunScreen />;
      case 'logs':
        return <LogScreen />;
      default:
        return <HomeScreen />;
    }
  };

  // Nav labels
  const navItems: { tab: TabType; label: string; icon: React.ReactNode }[] = [
    { 
      tab: 'home', 
      label: 'Home',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    { 
      tab: 'data', 
      label: 'Data Mapping',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    { 
      tab: 'logs', 
      label: 'Activity Logs',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  ];

  const hideNav = isRecording || isExecutionActive;

  return (
    <div className="w-[400px] h-[550px] overflow-hidden bg-slate-950 font-sans text-slate-100 flex flex-col select-none relative">
      
      {/* Sleek deep-space gradient background overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950/40 via-slate-950 to-slate-950 -z-10" />

      {/* Main Header Banner */}
      <header className="px-4 py-3 border-b border-slate-900 shrink-0 bg-slate-950/65 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold shadow-md shadow-indigo-600/25">
            F
          </div>
          <h1 className="text-sm font-extrabold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 via-slate-200 to-indigo-400">
            FormPilot
          </h1>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[8px] font-bold text-indigo-400/90 tracking-wide font-mono">
          v1.0.0
        </span>
      </header>

      {/* Content screen view viewport */}
      <main className="flex-1 overflow-hidden p-4">
        {renderScreen()}
      </main>

      {/* Bottom responsive glassmorphic Navigation tab bar */}
      {!hideNav && (
        <nav className="bg-slate-950 border-t border-slate-900 p-2 flex justify-around items-center shrink-0">
          {navItems.map((item) => {
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                onClick={() => setActiveTab(item.tab)}
                className={`flex flex-col items-center gap-1.5 py-1 px-3 rounded-xl transition text-[10px] font-bold active:scale-95 ${isActive ? 'text-indigo-400 bg-indigo-500/5' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};