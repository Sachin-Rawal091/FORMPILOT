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
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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
      await processFile(file);
    }
  };

  // Triggers native click on file input
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
      return <span className="px-1.5 py-0.5 rounded text-[8px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20">Unmatched</span>;
    }

    // Exact Match Comparison
    const targetName = (step.columnName || step.value || "").replace(/[{}]/g, '').trim().toLowerCase();
    if (mappedCol.toLowerCase().trim() === targetName) {
      return <span className="px-1.5 py-0.5 rounded text-[8px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">High Match</span>;
    }

    return <span className="px-1.5 py-0.5 rounded text-[8px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20">Fuzzy Match</span>;
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
      <div className="flex flex-col items-center justify-center h-96 text-center animate-fade-in gap-3 p-4">
        <div className="w-16 h-16 border rounded-full bg-slate-900 border-slate-800 flex items-center justify-center text-slate-500 opacity-60">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-slate-300">No Recording Selected</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-[240px]">
          Please go back to the home screen and select which automation flow you want to use.
        </p>
        <button
          onClick={() => setActiveTab('home')}
          className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs active:scale-95 transition"
        >
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in h-[430px]">
      
      {/* 1. Upload Section */}
      {excelData.length === 0 ? (
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-300">Load Spreadsheet Data</h4>
            <span className="text-[9px] text-slate-500 font-mono">Excel Parser v1.0</span>
          </div>

          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={openFilePicker}
            className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition ${isDragActive ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'border-slate-800 hover:border-indigo-500 bg-slate-900/10'}`}
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
                <svg className="w-8 h-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-xs font-semibold text-slate-300">Parsing spreadsheet worksheets...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-200">Drag & drop sheet here</span>
                  <span className="text-[10px] text-slate-500">or click to browse local files</span>
                </div>
              </div>
            )}
          </div>
          {errorMsg && (
            <span className="text-[10px] text-rose-400 font-semibold text-center mt-1">
              {errorMsg}
            </span>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-3.5 min-h-0">
          
          {/* File Loaded Header */}
          <div className="p-3 border rounded-xl bg-slate-900 border-slate-800/80 flex justify-between items-center text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-bold text-slate-300 truncate">Spreadsheet Connected</span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-400 font-mono shrink-0 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              {excelData.length} Rows Loaded
            </span>
          </div>

          {/* Fuzzy Mapping Table */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="flex justify-between items-center text-[10px] font-semibold text-slate-500 px-1">
              <span>Form Step Variable</span>
              <span>Spreadsheet Header Match</span>
            </div>

            {/* Mappings scroll container */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 scrollbar-thin">
              {mappingSteps.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  This recorded flow does not require any Excel variables. You can execute it directly.
                </div>
              ) : (
                mappingSteps.map((step, idx) => {
                  const mappedCol = fuzzyMapping[step.id] || '';
                  
                  return (
                    <div 
                      key={step.id} 
                      className="p-2.5 border rounded-xl bg-slate-900/50 border-slate-800/80 flex flex-col gap-2 hover:bg-slate-900 hover:border-slate-800 transition"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[9px] font-bold text-slate-500 font-mono">#{idx + 1}</span>
                          <span className="text-xs font-bold text-slate-200 truncate">{getStepLabel(step)}</span>
                        </div>
                        {getConfidenceBadge(step, mappedCol)}
                      </div>

                      {/* Selector mapping selector widgets */}
                      <div className="relative">
                        <select
                          value={mappedCol}
                          onChange={(e) => setMapping(step.id, e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded-lg bg-slate-950 border-slate-800 text-indigo-400 font-semibold focus:outline-none focus:border-indigo-500 transition appearance-none pr-8 cursor-pointer"
                        >
                          <option value="">-- Choose Excel Column --</option>
                          {excelHeaders.map(header => (
                            <option key={header} value={header} className="text-slate-300 font-normal">
                              {header}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-2.5 top-2.5 pointer-events-none text-slate-600">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. Bottom controls */}
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800/50">
            {errorMsg && (
              <span className="text-[9px] text-rose-400 font-semibold text-center mb-1">
                {errorMsg}
              </span>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Resets spreadsheet upload state
                  useFormPilotStore.setState({ excelData: [], excelHeaders: [], fuzzyMapping: {} });
                }}
                className="px-3 py-2 text-xs font-semibold text-slate-400 border border-slate-800 bg-slate-950 rounded-xl hover:bg-slate-900 active:scale-95 transition"
              >
                Clear Sheet
              </button>
              
              <button
                onClick={handleLaunchExecution}
                className="flex-1 py-2 bg-gradient-to-r from-indigo-600 to-cyan-500 hover:brightness-110 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-600/15 transition active:scale-98 flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Confirm & Run Automation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
