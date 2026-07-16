import React, { useRef, useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { Step, Action } from '../../types';

export const DataScreen: React.FC = () => {
  const {
    selectedRecording,
    excelRowCount,
    excelHeaders,
    fuzzyMapping,
    isExcelLoading,
    parseExcel,
    setMapping,
    startExecution,
    setActiveTab
  } = useFormPilotStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('form_data.xlsx');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setErrorMsg('');
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setErrorMsg('Please upload a valid Excel spreadsheet file (.xlsx or .xls).');
      return;
    }
    try {
      await parseExcel(file);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to parse Excel workbook.');
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setFileName(file.name);
      await processFile(file);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Find steps that require cell variables (FILL, SELECT, SELECT_RADIO, RICH_TEXT, DATEPICKER, TOGGLE_CHECKBOX)
  const mappingSteps = selectedRecording?.steps.filter(step => 
    step.action === Action.FILL ||
    step.action === Action.SELECT ||
    step.action === Action.SELECT_RADIO ||
    step.action === Action.RICH_TEXT ||
    step.action === Action.DATEPICKER ||
    step.action === Action.TOGGLE_CHECKBOX
  ) || [];

  const getStepLabel = (step: Step) => {
    const meta = step.selectorMeta;
    if (meta) {
      if (meta.labelText) return `Field: ${meta.labelText}`;
      if (meta.placeholder) return `Placeholder: ${meta.placeholder}`;
      if (meta.name) return `Field Name: ${meta.name}`;
      if (meta.id) return `Element ID: #${meta.id}`;
    }
    return `Selector: ${step.selector.slice(0, 24)}...`;
  };

  const getConfidenceBadge = (step: Step, mappedCol: string) => {
    if (!mappedCol) {
      return <span className="px-2 py-0.5 rounded-lg text-[9px] font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/20">Unmatched</span>;
    }

    const targetName = (step.columnName || step.value || "").replace(/[{}]/g, '').trim().toLowerCase();
    if (mappedCol.toLowerCase().trim() === targetName) {
      return <span className="px-2 py-0.5 rounded-lg text-[9px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20">High Match</span>;
    }

    return <span className="px-2 py-0.5 rounded-lg text-[9px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20">Fuzzy Match</span>;
  };

  const handleLaunchExecution = async () => {
    try {
      setErrorMsg('');
      await startExecution();
    } catch (err: any) {
      setErrorMsg(err.message || 'Execution ignition failed.');
    }
  };

  if (!selectedRecording) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center animate-fade-in gap-4 p-8 border border-slate-200/50 dark:border-slate-800 rounded-card bg-white dark:bg-fp-card-dark shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 font-outfit">No Workflow Selected</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            You must choose an automation workflow on the home screen before loading and mapping spreadsheet columns.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('home')}
          className="px-5 py-2.5 rounded-full bg-fp-accent text-white dark:bg-white dark:text-fp-sidebar font-semibold text-xs active:scale-95 transition shadow-md shadow-fp-accent/15"
        >
          Back to Workflows
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Title block */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold font-outfit tracking-wide text-slate-900 dark:text-white">
          Data Mapping Console
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
          Connect your Excel spreadsheet data rows with the target web selectors defined in <span className="font-semibold text-slate-800 dark:text-slate-200 font-outfit">"{selectedRecording.name}"</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Pane: Excel Dropzone & Info Block */}
        <div className="lg:col-span-5 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Spreadsheet Source
          </h3>

          {excelRowCount === 0 ? (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={openFilePicker}
              className={`border border-dashed rounded-card flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all duration-300 min-h-[320px] bg-white dark:bg-fp-card-dark shadow-sm ${
                isDragActive 
                  ? 'border-fp-accent bg-slate-100 dark:bg-slate-900' 
                  : 'border-slate-200 dark:border-slate-800/80 hover:border-fp-accent dark:hover:border-white'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
                className="hidden"
              />

              {isExcelLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <svg className="w-10 h-10 animate-spin text-fp-accent dark:text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Parsing workbook sheets...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-fp-accent/5 dark:bg-white/5 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">Drag & drop spreadsheet here</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 block">Supports Microsoft Excel files (.xlsx, .xls)</span>
                  </div>
                  <button 
                    type="button"
                    className="px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all duration-200"
                  >
                    Browse Files
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* File Info Card */}
              <div className="p-5 rounded-card bg-white dark:bg-fp-card-dark shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block truncate font-outfit">
                        {fileName}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 block">
                        Excel Workbook Connected
                      </span>
                    </div>
                  </div>

                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono shrink-0">
                    {excelRowCount} rows
                  </span>
                </div>

                {/* Headers visual badge wall */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pl-0.5">
                    Detected Columns ({excelHeaders.length})
                  </h5>
                  <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin">
                    {excelHeaders.map(h => (
                      <span 
                        key={h} 
                        className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-mono flex items-center gap-2 cursor-grab hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
                      >
                        <svg className="w-3 h-3 text-slate-400 dark:text-slate-650 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M7 2a2 2 0 100 4 2 2 0 000-4zM7 8a2 2 0 100 4 2 2 0 000-4zM7 14a2 2 0 100 4 2 2 0 000-4zM13 2a2 2 0 100 4 2 2 0 000-4zM13 8a2 2 0 100 4 2 2 0 000-4zM13 14a2 2 0 100 4 2 2 0 000-4z" />
                        </svg>
                        <span>{h}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Smaller quick dropzone to Swap file */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={openFilePicker}
                className={`border border-dashed rounded-card flex flex-col items-center justify-center p-4 text-center cursor-pointer transition bg-white/40 dark:bg-slate-950/10 border-slate-200 dark:border-slate-800/80 hover:border-fp-accent dark:hover:border-white`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 leading-normal px-2">
                  Drag and drop a new sheet here to replace connected source
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 border rounded-card bg-rose-500/5 border-rose-500/20 text-rose-500 font-semibold text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Right Pane: Column Mapping Console */}
        <div className="lg:col-span-7 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Column Mapping Configuration
          </h3>

          {excelRowCount === 0 ? (
            <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-card p-8 bg-white/20 dark:bg-slate-950/5 text-center flex flex-col items-center justify-center min-h-[320px] text-slate-400 dark:text-slate-500 gap-3">
              <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-400 block">Mapping Console Idle</span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 block max-w-xs mx-auto">
                  Connect a spreadsheet worksheet on the left to align form recording variables with sheet columns.
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              
              {/* Mapping list scroll pane */}
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-2 scrollbar-thin">
                {mappingSteps.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-card">
                    This automation flow does not have any input fields (Fill, Select, etc.) requiring spreadsheet columns. It runs statically.
                  </div>
                ) : (
                  mappingSteps.map((step, idx) => {
                    const mappedCol = fuzzyMapping[step.id] || '';
                    
                    return (
                      <div 
                        key={step.id} 
                        className="p-4 rounded-card bg-white dark:bg-fp-card-dark shadow-sm flex flex-col gap-3 hover:shadow transition-all duration-200"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-semibold font-mono text-slate-500 dark:text-slate-400 shrink-0 mt-0.5">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block truncate font-outfit">
                                {getStepLabel(step)}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 block truncate">
                                Selector: {step.selector}
                              </span>
                            </div>
                          </div>
                          {getConfidenceBadge(step, mappedCol)}
                        </div>

                        {/* Interactive Dropdown selection */}
                        <div className="relative">
                          <select
                            value={mappedCol}
                            onChange={(e) => setMapping(step.id, e.target.value)}
                            className="w-full px-4 py-2.5 text-xs border-2 rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-semibold focus:outline-none focus:border-fp-accent dark:focus:border-white transition appearance-none pr-10 cursor-pointer"
                          >
                            <option value="">-- Choose Excel Column --</option>
                            {excelHeaders.map(header => (
                              <option key={header} value={header} className="text-slate-800 dark:text-slate-200 font-normal">
                                {header}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-3.5 pointer-events-none text-slate-500 dark:text-slate-600">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Execution Actions footer */}
              <div className="flex flex-col gap-3 pt-4 border-t border-slate-200 dark:border-slate-800/60">
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-full active:scale-95 transition"
                  >
                    Clear Spreadsheet
                  </button>
                  
                  <button
                    onClick={handleLaunchExecution}
                    className="flex-1 py-3 bg-fp-accent text-white dark:bg-white dark:text-fp-sidebar font-semibold text-xs rounded-full shadow-md shadow-fp-accent/15 transition active:scale-98 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Execute Auto-Fill Pipeline</span>
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* BUG-AUDIT-01: Clear Spreadsheet Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="w-full max-w-sm border border-slate-200 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-[#121214] p-6 space-y-6 shadow-2xl animate-fade-in text-slate-950 dark:text-slate-100">
            
            <div className="flex gap-4 items-start text-left">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 dark:bg-amber-500/5 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0 border border-amber-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-semibold font-outfit text-slate-900 dark:text-white leading-none">
                  Clear Spreadsheet
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Clear all <strong className="text-slate-750 dark:text-slate-200 font-semibold">{excelRowCount}</strong> uploaded rows and column mappings? This cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl active:scale-95 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  useFormPilotStore.setState({ excelData: [], excelRowCount: 0, excelHeaders: [], fuzzyMapping: {} });
                  setShowClearConfirm(false);
                }}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-amber-600/10 active:scale-95 transition-all duration-200"
              >
                Clear Data
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
