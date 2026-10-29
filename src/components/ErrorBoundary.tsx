/**
 * @file src/components/ErrorBoundary.tsx
 * @description Catches render errors below it and shows a recoverable message instead of
 * unmounting the whole app (which leaves a blank window).
 */

import React from 'react';
import { RotateCcw, ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Heading shown when a child fails to render. */
  title?: string;
  /** What the user can do next, shown under the error message. */
  hint?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Open_IC980PM UI error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div role="alert" className="m-6 max-w-2xl p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-100 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-rose-200">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <span>{this.props.title ?? 'Something went wrong'}</span>
        </div>
        <p className="font-mono text-rose-200/90 break-words">{error.message || String(error)}</p>
        {this.props.hint && <p className="text-rose-100/80">{this.props.hint}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 rounded-lg font-semibold bg-rose-600/80 hover:bg-rose-500 text-white"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
