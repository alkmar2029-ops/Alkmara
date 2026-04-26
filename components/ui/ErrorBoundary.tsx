'use client';
import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 dark:text-red-400 mb-4" />
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">حدث خطأ غير متوقع</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">نعتذر عن هذا الخطأ. يرجى المحاولة مرة أخرى.</p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
