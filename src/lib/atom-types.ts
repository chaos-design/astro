import {
  trajectoryKeyLabels,
  trajectoryKindLabels,
} from "../config/app-config.ts";
import {
  getAtomIdForEvent,
  getAtomPlatformConfig,
} from "../config/atom-platforms.ts";
import type { TraceEvent } from "../types/trace.ts";
import { toAtomicDefinition } from "./atomic-projection.ts";

/**
 * The category label an atom shows as its "type": the atom-specific label wins
 * (`prompt.input` is SYSTEM, not the broad input kind), then the kind label,
 * then the raw kind. This is the *only* definition of TYPE: the trajectory row
 * badge, the hover card and the LOG badge all read from here, so the three
 * views can never disagree about what kind of atom a row stands for.
 *
 * The input is atom data (`AtomDefinition.key` / normalised `AtomicKind`),
 * never an event name and never a payload field. Values are a closed set of
 * short uppercase labels (SYSTEM, MODEL, TOOL, GATE, LOOP, ...), not free text.
 */
export function atomTypeLabel(key: string, kind: string) {
  return trajectoryKeyLabels[key] ?? trajectoryKindLabels[kind] ?? kind;
}

/** The atom data behind one LOG row's TYPE badge, also used by its tooltip. */
export type EventAtomType = {
  /** `AtomDefinition.key`, e.g. `tool.call`. */
  key: string;
  /** Normalised `AtomicKind`, e.g. `tool` (aliases already resolved). */
  kind: string;
  /** The displayed short label, e.g. `TOOL`. */
  label: string;
};

/**
 * One cached lookup per platform: atoms are a static config array and a LOG
 * with tens of thousands of rows must not rebuild or scan it on every render.
 * Keyed by the harness node id returned by `getAtomIdForEvent` so the LOG's
 * type and the atom highlighted in the canvas when that row is selected come
 * from the very same mapping.
 */
const typeByNodeId = new Map<string, ReadonlyMap<string, EventAtomType>>();

function atomTypesForPlatform(
  platformId: string,
): ReadonlyMap<string, EventAtomType> {
  const cached = typeByNodeId.get(platformId);
  if (cached) {
    return cached;
  }
  const config = getAtomPlatformConfig(platformId);
  const labels = new Map<string, EventAtomType>(
    config.atoms.map((atom) => {
      const definition = toAtomicDefinition(atom);
      return [
        `harness-${atom.id}`,
        {
          key: definition.key,
          kind: definition.kind,
          label: atomTypeLabel(definition.key, definition.kind),
        },
      ] as const;
    }),
  );
  typeByNodeId.set(platformId, labels);
  return labels;
}

/**
 * The TYPE of the *primary atom* for one trace event. A single LOG event
 * projects into several atoms, so the row shows the primary one — the same
 * atom `getAtomIdForEvent` selects for the canvas — instead of inventing a
 * second "event type" taxonomy. The kind is normalised through the projection
 * layer's `toAtomicDefinition`, exactly like a trajectory atom's kind.
 */
export function eventAtomType(
  event: TraceEvent,
  platformId: string,
): EventAtomType | null {
  return (
    atomTypesForPlatform(platformId).get(
      getAtomIdForEvent(event, platformId),
    ) ?? null
  );
}
