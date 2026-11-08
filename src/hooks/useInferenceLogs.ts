import { useEffect, useState } from "react";
import { getAccessToken } from "../api/tokens";

const MAX_LINES = 1000;

/** SSE is used for the log stream only (spec) — token goes as a query
 * param because EventSource can't set an Authorization header. */
export function useInferenceLogs(inferenceId: string | null): string[] {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    setLines([]);
    if (!inferenceId) return;

    const token = getAccessToken() ?? "";
    const url = `/orchestrator/inferences/${inferenceId}/logs/stream/?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);

    source.onmessage = (event: MessageEvent<string>) => {
      setLines((prev) => {
        const next = [...prev, event.data];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };

    return () => {
      source.close();
    };
  }, [inferenceId]);

  return lines;
}
