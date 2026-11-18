import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import './feedback.css';

type Props = { children: ReactNode; homePath: string };
type State = { failed: boolean };

/**
 * Catches a page that crashes while rendering, so one broken screen shows a message
 * instead of turning the whole app into a blank page. Mount it with a `key` that
 * changes on navigation, so moving to another page starts fresh.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="page-crash" role="alert">
      <div className="page-crash-card">
        <span className="page-crash-icon"><AlertTriangle size={20} aria-hidden="true" /></span>
        <h1>This page couldn’t be shown</h1>
        <p>Something went wrong while displaying it. Your saved data isn’t affected. Reload the page, or go back to your dashboard.</p>
        <div className="page-crash-actions">
          <a className="btn btn-secondary" href={this.props.homePath}>Go to dashboard</a>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      </div>
    </main>;
  }
}
