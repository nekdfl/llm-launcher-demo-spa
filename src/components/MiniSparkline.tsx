import { colors } from "../theme";

interface MiniSparklineProps {
  inValues: number[];
  outValues: number[];
}

/** Matches reference/dashboard/code.html's in-tile mini chart verbatim
 * (100x24 viewBox, no axes/labels). Only rendered for statuses that could
 * plausibly have traffic — see lib/status.ts hasLikelyTraffic. */
export function MiniSparkline({ inValues, outValues }: MiniSparklineProps) {
  if (inValues.length < 2) {
    return (
      <span data-testid="mini-sparkline-empty" className="text-neutral-600">
        —
      </span>
    );
  }

  const max = Math.max(1, ...inValues, ...outValues);
  const toPoints = (values: number[]) =>
    values.map((v, i) => `${(i / (values.length - 1)) * 100},${24 - (v / max) * 24}`).join(" ");

  return (
    <svg viewBox="0 0 100 24" className="w-full aspect-[100/24] mt-0.5" data-testid="mini-sparkline">
      <polyline
        points={toPoints(inValues)}
        fill="none"
        stroke={colors.chartBlue}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={toPoints(outValues)}
        fill="none"
        stroke={colors.chartOrange}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
