import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Action, Step } from '../src/types';
import { RecordingQueueHandler } from '../src/background/handlers/RecordingQueueHandler';
import { StorageManager } from '../src/storage/StorageManager';

vi.mock('../src/storage/StorageManager', () => {
  let mockState: any = null;
  return {
    StorageManager: {
      getRecordingState: vi.fn().mockImplementation(async () => mockState),
      setRecordingState: vi.fn().mockImplementation(async (state) => {
        mockState = state;
      }),
    }
  };
});

describe('Step Merging Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    RecordingQueueHandler.resetQueue();
  });

  it('should merge consecutive value-based steps on the same element in RecordingQueueHandler', async () => {
    const mockState = {
      isRecording: true,
      activeRecordingSteps: [] as Step[],
      activeRecordingUrl: 'http://localhost',
      recordingId: 'rec-123'
    };
    
    vi.spyOn(StorageManager, 'getRecordingState').mockResolvedValue(mockState);

    const step1: Step = {
      id: '1',
      action: Action.SELECT,
      selector: '#select-1',
      selectorMeta: {},
      pageId: 'page_1',
      value: 'val-1',
      required: false,
      retryable: true,
      maxRetries: 3
    };

    const step2: Step = {
      id: '2',
      action: Action.SELECT,
      selector: '#select-1',
      selectorMeta: {},
      pageId: 'page_1',
      value: 'val-2',
      required: false,
      retryable: true,
      maxRetries: 3
    };

    const step3: Step = {
      id: '3',
      action: Action.CLICK,
      selector: '#btn-1',
      selectorMeta: {},
      pageId: 'page_1',
      value: '',
      required: false,
      retryable: true,
      maxRetries: 3
    };

    RecordingQueueHandler.enqueueStep(step1);
    await RecordingQueueHandler.flushQueue();

    expect(mockState.activeRecordingSteps).toHaveLength(1);
    expect(mockState.activeRecordingSteps[0].value).toBe('val-1');

    RecordingQueueHandler.enqueueStep(step2);
    await RecordingQueueHandler.flushQueue();

    // Should merge because it's consecutive and SELECT on the same element
    expect(mockState.activeRecordingSteps).toHaveLength(1);
    expect(mockState.activeRecordingSteps[0].value).toBe('val-2');

    RecordingQueueHandler.enqueueStep(step3);
    await RecordingQueueHandler.flushQueue();

    // Should NOT merge CLICK
    expect(mockState.activeRecordingSteps).toHaveLength(2);
    expect(mockState.activeRecordingSteps[0].value).toBe('val-2');
    expect(mockState.activeRecordingSteps[1].action).toBe(Action.CLICK);
  });
});
