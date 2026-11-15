import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled application error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-lg text-center">
          <div className="font-display text-8xl text-zinc-300 dark:text-zinc-800">
            !
          </div>
          <h1 className="text-xl font-semibold">EatSafe could not load</h1>
          <p className="mt-2 font-mono text-sm text-zinc-500 dark:text-zinc-400">
            Reload the page to try again. If the problem continues, please
            report it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 font-mono text-sm tracking-widest bg-yellow-400 text-zinc-950 px-5 py-2.5 rounded-md cursor-pointer hover:bg-yellow-300"
          >
            RELOAD
          </button>
        </div>
      </main>
    );
  }
}
