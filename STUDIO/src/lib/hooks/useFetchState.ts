import { useCallback, useState } from "react";

export type FetchState<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export function useFetchState<T>() {
  const [state, setState] = useState<FetchState<T>>({
    status: "idle",
    data: null,
    error: null,
  });

  const run = useCallback(async (fetcher: () => Promise<T>) => {
    setState({ status: "loading", data: null, error: null });
    try {
      const data = await fetcher();
      setState({ status: "success", data, error: null });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", data: null, error: message });
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", data: null, error: null });
  }, []);

  const setData = useCallback((data: T) => {
    setState({ status: "success", data, error: null });
  }, []);

  return { state, run, reset, setData } as const;
}
