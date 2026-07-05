import React from 'react';
import { logger } from '../../utils/logger';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'The dashboard hit an unexpected error.'
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error('PopupErrorBoundary', error.message, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-fp-bg-light dark:bg-fp-bg-dark text-slate-900 dark:text-white flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-card bg-white dark:bg-fp-card-dark p-8 shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.008v.008H12V16.5zm-7.5 3h15L12 4.5 4.5 19.5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold font-outfit tracking-wide">Dashboard Error</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              FormPilot could not render this view. Reload the dashboard to restore the interface.
            </p>
          </div>
          <code className="block text-xs font-mono text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/20 rounded-xl p-3 break-words">
            {this.state.message}
          </code>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-fp-accent dark:bg-white text-white dark:text-fp-sidebar py-2.5 text-sm font-semibold active:scale-95 transition"
          >
            Reload Dashboard
          </button>
        </div>
      </div>
    );
  }
}
