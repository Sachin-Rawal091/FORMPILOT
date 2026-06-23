export enum Action {
  FILL,
  CLICK,
  SELECT,
  SELECT_RADIO,
  TOGGLE_CHECKBOX,
  WAIT,
  SCROLL,
  SUBMIT,
  FILE_UPLOAD,
  RICH_TEXT,
  NAVIGATE_NEXT,
  MANUAL_IFRAME,
  DATEPICKER,
}

export interface Step {
  id: string;
  action: Action;
  selector: string;
  selectorMeta: SelectorMeta;
  value?: string;
  options?: StepOptions;
  pageId: string;
  columnName?: string;
  required?: boolean;
  defaultValue?: string;
  expectedType?: "text" | "number" | "date" | "boolean";
  skipOnEmpty?: boolean;
  frameId?: number;
  checked?: boolean;
  retryable?: boolean;
  maxRetries?: number;
}

export interface StepOptions {
  /** Override the default step timeout (ms) */
  timeoutOverride?: number;
  /** Wait strategy to use before executing this step */
  waitStrategy?: 'domStability' | 'networkIdle' | 'urlChange' | 'none';
}

export interface SelectorMeta {
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  labelText?: string;
  cssPath?: string;
  xpath?: string;
}

export interface SelectorResult {
  element: Element;
  strategy: SelectorStrategy;
  confidence: number;
  shadow: boolean;
}

export enum SelectorStrategy {
  ID,
  NAME,
  ARIA_LABEL,
  LABEL_LINKED,
  PLACEHOLDER,
  CSS_PATH,
  XPATH,
  SHADOW_DOM,
}

export interface ExecutionState {
  sessionId: string;
  currentRowIndex: number;
  currentStepIndex: number;
  currentPageId: string;
  status: ExecutionStatus;
  totalRows: number;
  completedRows: number;
  failedRows: number;
  skippedRows: number;
  pageRetryCount: number;
  mutexLock: string | null;
  captchaPending: boolean;
  tabContext: number;
  lastStepResult: string;
  recordingId?: string;
  siteUrl?: string;
  currentUrl?: string;
}

export enum ExecutionStatus {
  IDLE,
  RUNNING,
  PAUSED,
  CAPTCHA_PAUSED,
  COMPLETE,
  FAILED,
}

export interface PageDef {
  id: string;
  urlPattern: string;
}

export interface Recording {
  id: string;
  name: string;
  siteUrl: string;
  siteId: string;
  steps: Step[];
  pages: PageDef[];
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface ExcelRow {
  rowIndex: number;
  data: Record<string, string | number | boolean | null>;
  status: RowStatus;
  isValid: boolean;
  validationErrors: string[];
  error?: string;
}

export enum RowStatus {
  PENDING,
  SUCCESS,
  FAILED,
  SKIPPED,
}

export interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  rowIndex: number;
  stepId: string;
  action: Action;
  selector: string;
  value?: string;
  result: StepResult;
  status: LogStatus;
  error?: string;
  retryCount: number;
  duration: number;
  selectorStrategy?: SelectorStrategy;
}

export enum StepResult {
  SUCCESS,
  FAILED,
  SKIPPED,
}

export type LogStatus =
  | "FILLED"
  | "FILLED_DEFAULT"
  | "FILLED_COERCED"
  | "STEP_SKIPPED"
  | "WARN"
  | "ROW_SKIPPED"
  | "RETRIED"
  | "CAPTCHA_DETECTED"
  | "SUCCESS"
  | "FAILED";

export interface FormPilotMessage<T = unknown> {
  type: MessageType;
  payload: T;
  sessionId: string;
  tabId?: number;
  timestamp: number;
}

export enum MessageType {
  START_RECORDING,
  STOP_RECORDING,
  START_EXECUTION,
  PAUSE_EXECUTION,
  RESUME_EXECUTION,
  ABORT_EXECUTION,
  RECORDING_EVENT,
  EXECUTION_PROGRESS,
  EXECUTION_COMPLETE,
  STEP_RESULT,
  STATE_UPDATE,
  ERROR_REPORT,
  CAPTCHA_DETECTED,
  PAGE_NAVIGATED,
  GET_STATUS,
  GET_RECORDING_DATA,
  GET_EXCEL_DATA,
  SET_EXCEL_DATA,
  ADD_LOG_ENTRY,
  SET_EXECUTION_STATE,
  GET_EXECUTION_STATE,
  CLEAR_BADGE,
}

export interface RecordingState {
  isRecording: boolean;
  activeRecordingSteps: Step[];
  activeRecordingUrl: string;
  recordingId?: string;
}

export interface UserSettings {
  // Placeholder for user settings
}


export interface SessionMeta {
  sessionId: string;
  timestamp: number;
  // Additional meta fields if needed
}

export interface FileBlob {
  alias: string;
  data: Blob;
  name: string;
  type: string;
}
