import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HaojieGame } from './index';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('浩劫 UI failure', error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main style={{ fontFamily: 'system-ui', maxWidth: 600, margin: '12vh auto', padding: 24 }}>
          <h1>棋局界面暂时遇到了问题</h1>
          <p>已保存的局面没有被主动清除。刷新后会尝试恢复。</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
          <button onClick={() => window.location.reload()}>刷新界面</button>
        </main>
      );
    return this.props.children;
  }
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount point');
createRoot(root).render(
  <ErrorBoundary>
    <HaojieGame />
  </ErrorBoundary>,
);
