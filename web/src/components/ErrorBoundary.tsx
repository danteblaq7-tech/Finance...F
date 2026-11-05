import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui';

/** Last line of defence: a bug on one screen shows a message and a reload button instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI crashed:', error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-display text-xl font-black">Something went wrong</h1>
        <p className="text-ink-secondary">The page hit an unexpected problem. Reloading usually fixes it.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </main>
    );
  }
}
