/**
 * Creeps are typed by body shape, not job. Every type can do any task its parts allow; the shape
 * just makes it better at some:
 * - drone: WORK ~ CARRY. Picks a task (fill/build/repair/upgrade) each load, and covers for
 *   missing miners and workers by harvesting or upgrading itself.
 * - miner: 5 WORK, 1 MOVE, no CARRY. The cheapest body that fully mines a source; can only mine.
 * - worker: WORK-heavy with 1 CARRY. Parked at the controller container, upgrading nonstop.
 * - hauler: CARRY + MOVE. Moves energy from a source container to where it's needed.
 */
type CreepType = "drone" | "miner" | "worker" | "hauler";

type WorkerTask = "fill" | "build" | "repair" | "upgrade";

/** The source a miner mines or a hauler empties. */
type Post = Id<Source>;

interface CreepMemory {
  type: CreepType;
  /** Room this creep belongs to (where it was spawned). */
  room: string;
  /** true while spending energy, false while gathering it. */
  working: boolean;
  /** Index into the type's body tiers (utils/body.ts) at spawn time. */
  tier?: number;
  /** Surplus or outdated: heading to a spawn to be recycled. See managers/retirement.ts. */
  retiring?: boolean;
  /** miner and hauler: which source this creep works. */
  post?: Post;
  /** drone: source it harvests when nothing is stockpiled. Kept until the source is unsafe or over capacity. */
  sourceId?: Id<Source>;
  /** drone: the source whose container site it's building in place. See roles/drone.ts. */
  station?: Id<Source>;
  /** drone: construction site it's working on, kept until done or outranked. */
  siteId?: Id<ConstructionSite>;
  /** drone: what it's spending its current load on. */
  task?: WorkerTask;
}

interface Memory {
  /** Per-site overrides, keyed by construction site id. See utils/construction.ts. */
  constructionSites?: Record<string, { priority: number }>;
  /** Tuning knobs, settable from the console. See utils/settings.ts. */
  settings?: Partial<Settings>;
}

interface Settings {
  /** Drones kept around at all times, for building, repairs and covering gaps. */
  minDrones: number;
  /** Drones added while there are construction sites. */
  builders: number;
  /** Share of static-source income spent by worker upgraders. */
  upgradeShare: number;
}

/** Screeps only provides console.log (output appears in the in-game console). */
declare const console: { log(...args: unknown[]): void };
