import { StateCreator } from 'zustand';
import { UserSettings } from '../../../types';
import { StorageManager } from '../../../storage/StorageManager';

export interface SettingsSlice {
  settings: UserSettings;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => Promise<void>;
}

export const createSettingsSlice: StateCreator<any, [], [], SettingsSlice> = (set, get) => ({
  settings: {
    stepDelay: 100,
    maxStepRetries: 3,
    waitElementTimeout: 10000,
    logMaxEntries: 1000,
    logRetentionDays: 30,
    theme: 'dark'
  },

  updateSettings: async (newSettings) => {
    const current = get().settings;
    const updated = { ...current, ...newSettings };
    set({ settings: updated });
    await StorageManager.setUserSettings(updated);
  },

  setTheme: async (theme) => {
    const current = get().settings;
    const updated = { ...current, theme };
    set({ settings: updated });
    await StorageManager.setUserSettings(updated);
    
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
});
