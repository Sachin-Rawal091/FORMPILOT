import React, { useEffect } from 'react';
import { useFormPilotStore, TabType } from './store/useFormPilotStore';
import { HomeScreen } from './screens/HomeScreen';
import { RecordingScreen } from './screens/RecordingScreen';
import { DataScreen } from './screens/DataScreen';
import { RunScreen } from './screens/RunScreen';
import { LogScreen } from './screens/LogScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ExecutionStatus } from '../types';

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab, 
    isRecording, 
    executionState, 
    settings,
    setTheme,
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
      case 'settings':
        return <SettingsScreen />;
      default:
        return <HomeScreen />;
    }
  };

  // Nav labels
  const navItems: { tab: TabType; label: string; icon: React.ReactNode }[] = [
    { 
      tab: 'home', 
      label: 'Home Dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    { 
      tab: 'data', 
      label: 'Data Mapping',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    { 
      tab: 'logs', 
      label: 'Activity Logs',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    { 
      tab: 'settings', 
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    }
  ];

  const hideNav = isRecording || isExecutionActive;
  const currentTheme = settings.theme || 'dark';

  const toggleTheme = () => {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  };

  // Full screen viewport taking over when in recording or execution state
  if (hideNav) {
    return (
      <div className="w-full h-screen overflow-hidden bg-fp-bg-light dark:bg-fp-bg-dark text-slate-900 dark:text-slate-100 transition-colors duration-300 flex flex-col">
        {renderScreen()}
      </div>
    );
  }

  return (
    <div className="w-full h-screen overflow-hidden flex bg-fp-bg-light dark:bg-fp-bg-dark text-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans">
      
      {/* Sidebar Navigation (Always Dark) */}
      <aside className="w-64 bg-fp-sidebar text-slate-300 border-r border-slate-900 flex flex-col justify-between h-screen sticky top-0 shrink-0 select-none">
        <div>
          {/* Logo Brand Header */}
          <div className="px-6 py-6 border-b border-slate-800/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white font-black border border-white/15">
                FP
              </div>
              <div className="flex flex-col">
                <span className="font-outfit font-semibold tracking-wide text-base text-white">
                  FormPilot
                </span>
                <span className="text-[10px] text-slate-500 font-medium">Form Automation</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-black/20 border border-white/10 text-[9px] font-semibold text-slate-300 tracking-wide font-mono">
              v1.0.0
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.tab;
              return (
                <button
                  key={item.tab}
                  onClick={() => setActiveTab(item.tab)}
                  className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-xl transition-all duration-200 text-sm font-semibold ${
                    isActive 
                      ? 'text-white bg-white/10 shadow-sm' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.icon}
                  <span className="font-outfit">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer with Theme Toggle */}
        <div className="flex flex-col border-t border-slate-800/60">
          {/* Theme Switcher Toggle */}
          <div className="p-4 border-b border-slate-800/40">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all duration-200 text-sm font-semibold"
            >
              <div className="flex items-center gap-3">
                {currentTheme === 'light' ? (
                  <>
                    <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                    </svg>
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                    <span>Dark Mode</span>
                  </>
                )}
              </div>
              <div className="w-8 h-4 rounded-full bg-slate-900 p-0.5 flex items-center transition-colors">
                <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${currentTheme === 'dark' ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === 'run' ? (
          renderScreen()
        ) : (activeTab === 'home' || activeTab === 'logs' || activeTab === 'settings') ? (
          <div className="flex-1 overflow-hidden p-8 md:p-12 flex flex-col h-full">
            <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col min-h-0 h-full">
              {renderScreen()}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-x-hidden overflow-y-auto p-8 md:p-12">
            <div className="max-w-6xl mx-auto w-full">
              {renderScreen()}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
