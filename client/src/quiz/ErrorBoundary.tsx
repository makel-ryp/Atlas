/**
 * Stops one broken screen from blanking the whole quiz.
 *
 * React unmounts the entire tree when a render throws, so without this a golfer sees a white
 * page and loses the session. Their answers are already saved server-side, so the honest
 * recovery is "reload and you'll pick up where you were" — which is exactly what the shell's
 * resume-from-run logic does.
 *
 * The result screen is the reason this exists. It reads a dozen optional fields off the
 * engine's output (`mi.verdict`, `ghostZone`, `chips`, `falsePriors`…), and an unexpected
 * shape there would otherwise take the whole app down at the moment the golfer finally
 * earned something.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as a console error on purpose: there's no error-reporting service wired up yet,
    // and swallowing it silently would make this boundary worse than no boundary at all.
    console.error('Quiz screen failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div role="alert" className="mx-auto max-w-md">
        <h2 className="mb-3 text-xl font-bold tracking-tight">Something broke on our end.</h2>
        <p className="mb-6 text-sm leading-relaxed text-ink/70">
          Your answers are saved. Reload the page and you'll pick up where you left off.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper"
        >
          Reload
        </button>
      </div>
    );
  }
}
