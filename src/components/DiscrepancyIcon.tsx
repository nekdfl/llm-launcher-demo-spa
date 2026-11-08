/** Standalone icon next to the name, never folded into the name itself
 * (spec: "SHALL NOT изменять само отображаемое имя"). Matches
 * reference/inference_detail's Material Symbols "warning" glyph. */
export function DiscrepancyIcon({ title = "расхождение с профилем" }: { title?: string }) {
  return (
    <span
      className="material-symbols-outlined text-warn text-sm align-middle"
      title={title}
      data-testid="discrepancy-icon"
      role="img"
      aria-label={title}
    >
      warning
    </span>
  );
}
