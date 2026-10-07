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

/** What a drone spends a load on. See logistics/network.ts. */
type SinkKind = "fill" | "tower" | "build" | "repair" | "upgrade";

type RouteTarget = ConstructionSite | StructureTower | Structure;

/** A drone's assignment from the logistics planner: where it loads and what it spends on. */
interface Route {
  /** A Source to harvest, or a container/storage to withdraw from. */
  from: Id<Source | StructureContainer | StructureStorage>;
  kind: SinkKind;
  /** The site, tower or structure it works on; unset for fill and upgrade. */
  target?: Id<RouteTarget>;
}

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
  /** drone: its current route, set by managers/logistics.ts. */
  route?: Route;
}

interface Memory {
  /** Per-site overrides, keyed by construction site id. See utils/construction.ts. */
  constructionSites?: Record<string, { priority: number }>;
  /** Tuning knobs, settable from the console. See utils/settings.ts. */
  settings?: Partial<Settings>;
}

interface Settings {
  /** Drones kept around at all times, even when the logistics plan has no use for them. */
  minDrones: number;
  /** Most drones the spawner will keep, however many the logistics plan could use. */
  maxDrones: number;
  /**
   * Fraction of a single-spot source's time the logistics plan books. Creeps arrive in bunches,
   * so a fully booked spot means a standing queue; sources with more spots are allowed higher
   * utilization (square-root staffing, see logistics/assign.ts).
   */
  spotUtilization: number;
  /**
   * A route only gets a drone if it delivers at least this many times the drone's upkeep (body
   * cost / 1500 per tick). Keeps small drones off long hauls, which miners and haulers do better.
   */
  minRouteReturn: number;
  /** Draw the logistics plan's routes in the room. */
  showRoutes: boolean;
  /** Share of static-source income spent by worker upgraders. */
  upgradeShare: number;
}

/** Screeps only provides console.log (output appears in the in-game console). */
declare const console: { log(...args: unknown[]): void };
