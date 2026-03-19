import React from 'react';

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected application error',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Dashboard crashed', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      errorMessage: null,
    });
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="w-full max-w-lg rounded-3xl border bg-card p-8 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-rose-600">
              Application Error
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              Dashboard needs a clean refresh
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              A component crashed while rendering. Session data is still intact, but this screen
              needs to reload before we continue.
            </p>
            {this.state.errorMessage && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {this.state.errorMessage}
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={this.handleReset}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
              >
                Reload dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
