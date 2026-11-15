import type { Inference, Profile } from "../api/types";
import { anyOverridden } from "./launchParams";

/** Whether the inference's current parameter values have drifted from its
 * source profile — shown as a standalone badge next to the name, never
 * folded into the name itself (spec: "SHALL NOT изменять само отображаемое
 * имя"). Сравнение то же, что даёт пометки «переопределено» в карточке. */
export function hasProfileDiscrepancy(inference: Inference, profile: Profile): boolean {
  if (inference.profile_id !== profile.id) return true;
  if (profile.port !== null && inference.port !== profile.port) return true;
  return anyOverridden(inference, profile);
}
