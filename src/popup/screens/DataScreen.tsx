import React, { useRef, useState } from 'react';
import { useFormPilotStore } from '../store/useFormPilotStore';
import { Step, Action } from '../../types';

export const DataScreen: React.FC = () => {
  const {
    selectedRecording,
    excelData,
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

  // Find steps that require cell variables (FILL, SELECT, SELECT_RADIO, RICH_TEXT, DATEPICKER)
  const mappingSteps = selectedRecording?.steps.filter(step => 
    step.action === Action.FILL ||
    step.action === Action.SELECT ||
    step.action === Action.SELECT_RADIO ||
    step.action === Action.RICH_TEXT ||
    step.action === Action.DATEPICKER
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
      return <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20">Unmatched</span>;
    }

    const targetName = (step.columnName || step.value || "").replace(/[{}]/g, '').trim().toLowerCase();
    if (mappedCol.toLowerCase().trim() === targetName) {
      return <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20">High Match</span>;
    }

    return <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20">Fuzzy Match</span>;
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
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center animate-fade-in gap-4 p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/40 dark:bg-slate-950/5">
        <div className="w-16 h-16 border rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 font-outfit">No Workflow Selected</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            You must choose an automation workflow on the home screen before loading and mapping spreadsheet columns.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('home')}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs active:scale-95 transition shadow-lg shadow-indigo-600/10"
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
        <h2 className="text-2xl font-black font-outfit tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 dark:from-white dark:via-indigo-200 dark:to-white">
          Data Mapping Console
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
          Connect your Excel spreadsheet data rows with the target web selectors defined in <span className="font-semibold text-slate-800 dark:text-slate-200">"{selectedRecording.name}"</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Pane: Excel Dropzone & Info Block */}
        <div className="lg:col-span-5 space-y-6">
          <h3 className="text-base font-bold font-outfit text-slate-800 dark:text-slate-200">
            Spreadsheet Source
          </h3>

          {excelData.length === 0 ? (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={openFilePicker}
              className={`border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all duration-300 min-h-[320px] bg-white/50 dark:bg-slate-950/10 ${
                isDragActive 
                  ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_25px_rgba(99,102,241,0.1)]' 
                  : 'border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500/50 hover:bg-white dark:hover:bg-slate-900/20'
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
                  <svg className="w-10 h-10 animate-spin text-indigo-600 dark:text-indigo-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Parsing workbook sheets...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 dark:bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 block">Drag & drop spreadsheet here</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 block">Supports Microsoft Excel files (.xlsx, .xls)</span>
                  </div>
                  <button 
                    type="button"
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/80 transition"
                  >
                    Browse Files
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* File Info Card */}
              <div className="p-5 border-2 rounded-2xl bg-white dark:bg-slate-950/20 border-slate-200 dark:border-slate-800/80 shadow-[0_0_20px_rgba(0,0,0,0.01)] flex flex-col gap-4">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 block truncate">
                        {fileName}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 block">
                        Excel Workbook Connected
                      </span>
                    </div>
                  </div>

                  <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono shrink-0">
                    {excelData.length} rows
                  </span>
                </div>

                {/* Headers visual badge wall */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-0.5">
                    Detected Headers ({excelHeaders.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                    {excelHeaders.map(h => (
                      <span key={h} className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                        {h}
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
                className={`border border-dashed rounded-2xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition bg-slate-100/30 dark:bg-slate-950/5 ${
                  isDragActive 
                    ? 'border-indigo-500 bg-indigo-500/5' 
                    : 'border-slate-200 dark:border-slate-800/80 hover:border-indigo-500 dark:hover:border-indigo-500/40'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  Drag and drop a new sheet here to replace connected source
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 border rounded-2xl bg-rose-500/10 border-rose-500/20 text-rose-500 font-semibold text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Right Pane: Column Mapping Console */}
        <div className="lg:col-span-7 space-y-6">
          <h3 className="text-base font-bold font-outfit text-slate-800 dark:text-slate-200">
            Column Mapping Configuration
          </h3>

          {excelData.length === 0 ? (
            <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-8 bg-white/20 dark:bg-slate-950/5 text-center flex flex-col items-center justify-center min-h-[320px] text-slate-400 dark:text-slate-500 gap-3">
              <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-400 block">Mapping Console Idle</span>
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
                  <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    This automation flow does not have any input fields (Fill, Select, etc.) requiring spreadsheet columns. It runs statically.
                  </div>
                ) : (
                  mappingSteps.map((step, idx) => {
                    const mappedCol = fuzzyMapping[step.id] || '';
                    
                    return (
                      <div 
                        key={step.id} 
                        className="p-4 border-2 rounded-2xl bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800/80 flex flex-col gap-3 hover:border-slate-300 dark:hover:border-slate-800 transition-all duration-200"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-bold font-mono text-slate-500 dark:text-slate-400 shrink-0 mt-0.5">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 block truncate">
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
                            className="w-full px-4 py-2.5 text-xs border-2 rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-indigo-600 dark:text-indigo-400 font-bold focus:outline-none focus:border-indigo-500 transition appearance-none pr-10 cursor-pointer"
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
                    onClick={() => {
                      useFormPilotStore.setState({ excelData: [], excelHeaders: [], fuzzyMapping: {} });
                    }}
                    className="px-4 py-3 text-xs font-bold text-slate-500 dark:text-slate-400 border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-xl active:scale-95 transition"
                  >
                    Clear Spreadsheet
                  </button>
                  
                  <button
                    onClick={handleLaunchExecution}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/10 transition active:scale-98 flex items-center justify-center gap-2"
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
    </div>
  );
};
