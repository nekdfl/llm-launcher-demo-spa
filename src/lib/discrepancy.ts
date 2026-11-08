import type { Inference, Profile } from "../api/types";

function sameGpuIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function sameStructuralFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** Whether the inference's current parameter values have drifted from its
 * source profile — shown as a standalone badge next to the name, never
 * folded into the name itself (spec: "SHALL NOT изменять само отображаемое
 * имя"). */
export function hasProfileDiscrepancy(inference: Inference, profile: Profile): boolean {
  if (inference.profile_id !== profile.id) return true;
  if (!sameGpuIds(inference.gpu_ids, profile.gpu_ids)) return true;
  if (profile.port !== null && inference.port !== profile.port) return true;
  if (!sameStructuralFields(inference.structural_fields, profile.structural_fields)) return true;
  if (inference.cli_options !== profile.cli_options) return true;
  if (inference.system_prompt !== profile.system_prompt) return true;
  return false;
}
