import { StateCreator } from 'zustand';
import { ExcelRow, Step, Recording, Action } from '../../../types';
import { StorageManager } from '../../../storage/StorageManager';
import { ExcelDataEngine } from '../../../utils/ExcelDataEngine';
import { logger } from '../../../utils/logger';

export interface DataSlice {
  excelData: ExcelRow[];
  excelRowCount: number;
  excelHeaders: string[];
  fuzzyMapping: Record<string, string>; // step.id -> excelColumnName
  isExcelLoading: boolean;

  parseExcel: (file: File) => Promise<void>;
  setMapping: (stepId: string, columnName: string) => void;
  saveMappings: () => Promise<void>;
}

export const createDataSlice: StateCreator<any, [], [], DataSlice> = (set, get) => ({
  excelData: [],
  excelRowCount: 0,
  excelHeaders: [],
  fuzzyMapping: {},
  isExcelLoading: false,

  parseExcel: async (file: File) => {
    set({ isExcelLoading: true });
    try {
      const buffer = await file.arrayBuffer();
      const rows = await ExcelDataEngine.parseExcelFile(buffer);
      
      await StorageManager.setExcelData(rows);

      let headers: string[] = [];
      if (rows.length > 0) {
        headers = Object.keys(rows[0].data);
      }

      const selected = get().selectedRecording;
      let updatedRecording = null;
      const mapping: Record<string, string> = {};

      if (selected) {
        const clearedSteps = selected.steps.map((step: Step) => ({
          ...step,
          columnName: undefined
        }));
        updatedRecording = {
          ...selected,
          steps: clearedSteps
        };
      }

      if (updatedRecording && headers.length > 0) {
        updatedRecording.steps.forEach((step: Step) => {
          const targetName = step.selectorMeta?.labelText || step.selectorMeta?.placeholder || step.selectorMeta?.name || step.value || "";
          if (targetName) {
            const cleanTarget = targetName.replace(/[{}]/g, '').trim();
            const match = ExcelDataEngine.fuzzyMatchColumn(cleanTarget, headers);
            if (match) {
              mapping[step.id] = match;
            }
          }
        });
      }

      logger.debug('DataSlice', 'Auto-mapping found:', mapping);

      // After IndexedDB write, keep only headers + row count — don't hold
      // the full row array in popup memory indefinitely.
      set({
        excelData: [],
        excelRowCount: rows.length,
        excelHeaders: headers,
        fuzzyMapping: mapping,
        selectedRecording: updatedRecording || selected,
        isExcelLoading: false,
        activeTab: 'data'
      });
    } catch (err) {
      set({ isExcelLoading: false });
      logger.error('DataSlice', 'Excel parse failed:', err);
      throw err;
    }
  },

  setMapping: (stepId: string, columnName: string) => {
    set((prev: DataSlice) => ({
      fuzzyMapping: {
        ...prev.fuzzyMapping,
        [stepId]: columnName
      }
    }));
  },

  saveMappings: async () => {
    const selectedRecording = get().selectedRecording;
    if (!selectedRecording) return;
    const { fuzzyMapping, recordings } = get();

    const updatedSteps = selectedRecording.steps.map((step: Step) => {
      const mappedCol = fuzzyMapping[step.id];
      const isDate = step.action === Action.DATEPICKER;
      return {
        ...step,
        columnName: mappedCol || undefined,
        value: mappedCol ? `{{${mappedCol}}}` : step.value,
        defaultValue: step.defaultValue || (mappedCol ? step.value : undefined),
        expectedType: isDate ? "date" as const : step.expectedType
      };
    });

    logger.debug('DataSlice', 'Saving updated step mappings:', updatedSteps.map((s: Step) => ({
      id: s.id,
      col: s.columnName,
      val: s.value
    })));

    const updatedRecording = {
      ...selectedRecording,
      steps: updatedSteps,
      updatedAt: Date.now()
    };

    const updatedRecordings = recordings.map((rec: Recording) => 
      rec.id === updatedRecording.id ? updatedRecording : rec
    );

    await StorageManager.setRecordings(updatedRecordings);
    set({
      recordings: updatedRecordings,
      selectedRecording: updatedRecording
    });
  }
});
