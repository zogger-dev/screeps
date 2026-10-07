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

/**
 * A hauler's committed delivery: filling the spawn, extensions or a tower, stocking a container or
 * storage (`id` is the structure), or feeding a creep working at a site (`id` is its name).
 */
interface Dropoff {
  kind: "fill" | "stock" | "feed";
  id: string;
}

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
  /**
   * Where to wait when the supply is busy, if it sits behind a choke: the first wide tile on the
   * way back from it. Waiting inside a choke would block it. See logistics/traffic.ts.
   */
  hold?: { x: number; y: number };
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
  /** hauler: where it's taking its load; kept until delivered there. See roles/hauler.ts. */
  dropoff?: Dropoff;
  /** hauler: where it's loading from; kept until that's empty. */
  pickup?: Id<Resource | Tombstone | Ruin | StructureContainer | StructureStorage>;
}

interface Memory {
  /** Per-site overrides, keyed by construction site id. See utils/construction.ts. */
  constructionSites?: Record<string, { priority: number }>;
  /** Tuning knobs, settable from the console. See utils/settings.ts. */
  settings?: Partial<Settings>;
  /**
   * Extra areas the towers should cover, beyond the spawn pocket, controller and core, e.g.
   * planned extension fields. Shared by every room's defense plan; see defense/towers.ts.
   */
  defenseTargets?: DefenseTarget[];
  /** Zone partitions per room, computed on request with `zones("room")`. See plan/zones.ts. */
  zones?: Record<string, import("./plan/zones").Partition>;
  /** Defense plans per room, computed on request with `defense("room")`. See defense/plan.ts. */
  defense?: Record<string, import("./defense/plan").DefensePlan>;
  /**
   * Core site candidates per room, best first, computed with `core("room")`; `pick` (1-based)
   * overrides the automatic choice. See defense/core.ts.
   */
  core?: Record<string, { candidates: import("./defense/core").CoreCandidate[]; pick?: number; computedAt: number }>;
}

/** A custom tower target: an area (e.g. an extension field) or a pocket's entrances. */
interface DefenseTarget {
  name: string;
  /** Room it's in; omitted means every room. */
  room?: string;
  x: number;
  y: number;
  /** Level from which it matters (when what it protects gets built). */
  fromRcl: number;
  /** "area": walkable tiles within `radius` of (x, y). "entrances": the ring of the pocket around (x, y). */
  kind: "area" | "entrances";
  radius?: number;
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
  /**
   * Damage-per-tick equivalent of each tile an attacker could shoot a tower from: how strongly tower
   * placement prefers nooks in the rock over coverage (a fully open spot has 49 such tiles).
   */
  towerExposureCost: number;
  /** Draw the defense plan (outer ring and tower spots) in the room. */
  showDefense: boolean;
  /** Draw the chosen core pocket (inner ring) and the other candidates in the room. */
  showCore: boolean;
  /** Tint the room's zones and number them in development order. */
  showZones: boolean;
  /** Share of static-source income spent by worker upgraders. */
  upgradeShare: number;
}

/** Screeps only provides console.log (output appears in the in-game console). */
declare const console: { log(...args: unknown[]): void };
