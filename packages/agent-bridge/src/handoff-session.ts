import { type CaliperHandoffState, CaliperHandoffStateSchema } from "@oyerinde/caliper-schema";
import { HANDOFF_SESSION_KEY } from "@caliper/core";

export function readPersistedHandoff(): CaliperHandoffState | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(HANDOFF_SESSION_KEY);
    if (!raw) {
      return null;
    }
    return CaliperHandoffStateSchema.parse(JSON.parse(raw));
  } catch {
    sessionStorage.removeItem(HANDOFF_SESSION_KEY);
    return null;
  }
}

export function persistHandoff(handoff: CaliperHandoffState | null) {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  if (!handoff) {
    sessionStorage.removeItem(HANDOFF_SESSION_KEY);
    return;
  }

  sessionStorage.setItem(HANDOFF_SESSION_KEY, JSON.stringify(handoff));
}
