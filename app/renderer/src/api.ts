/** The bridge preload put on window.edward, typed, plus a small hook for loading a page's data. */
import { useCallback, useEffect, useState } from "react";
import type { Bridge, EdwardApi } from "../../shared/api";

declare global {
  interface Window {
    edward: Bridge & { ready(): Promise<boolean> };
  }
}

export const edward = window.edward;

export function call<K extends keyof EdwardApi>(method: K, ...args: Parameters<EdwardApi[K]>): ReturnType<EdwardApi[K]> {
  return edward.call(method, ...args);
}

/** Loads data for a page; `reload` fetches it again. Errors are shown, not thrown. */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setLoading(true);
    run().then(
      (d) => live && (setData(d), setError(null), setLoading(false)),
      (e: unknown) => live && (setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [run, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}
