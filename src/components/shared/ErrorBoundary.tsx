import { Component, type ReactNode } from "react";

/** What a render that threw leaves on screen, instead of nothing.
 *
 * Mostly for the lazily loaded editor: its chunk is fetched on the first visit
 * to /edit, and a deploy between loading the page and that visit leaves the
 * page asking for a file the new deploy no longer has. Reloading fetches the
 * page that knows the new name. React offers no hook for catching a render,
 * which is why this is the one class component. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted">This page could not be loaded: {error.message}</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="cursor-pointer rounded-lg bg-raised/60 px-4 py-2 text-sm text-ink transition-colors hover:bg-raised"
        >
          Reload
        </button>
      </div>
    );
  }
}
