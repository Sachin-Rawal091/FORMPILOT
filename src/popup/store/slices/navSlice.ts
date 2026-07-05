import { StateCreator } from 'zustand';

export type TabType = 'home' | 'recording' | 'data' | 'run' | 'logs' | 'settings';

export interface NavSlice {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export const createNavSlice: StateCreator<any, [], [], NavSlice> = (set) => ({
  activeTab: 'home',
  setActiveTab: (tab) => set({ activeTab: tab }),
});
