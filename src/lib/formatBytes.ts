export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";

  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;

  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;

  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;

  // Under 1 KB (including 0) — whole bytes, no meaningful fractional unit.
  return `${bytes.toFixed(0)} B`;
}
