import { homeCreeps } from "./census";
import { isLairWallSpot } from "./lairs";

/** Default build order by structure type; lower builds first. Anything unlisted gets DEFAULT_PRIORITY. */
const TYPE_PRIORITY: Partial<Record<BuildableStructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_EXTENSION]: 1,
  // Source containers gate the switch to static miners, so they rank with extensions.
  [STRUCTURE_CONTAINER]: 1,
  [STRUCTURE_TOWER]: 2,
  [STRUCTURE_STORAGE]: 4,
  [STRUCTURE_ROAD]: 20,
  [STRUCTURE_RAMPART]: 30,
  [STRUCTURE_WALL]: 31,
};
const DEFAULT_PRIORITY = 10;
/**
 * Walls trapping a keeper lair jump the queue: each costs 1 energy and builds in one tick, but
 * they can only be built while the keeper is dead, so the window shouldn't be wasted.
 */
const LAIR_WALL_PRIORITY = -1;

/**
 * Build priority for a site. Override a single site from the console with
 * `Memory.constructionSites["<site id>"] = { priority: 0 }`.
 */
export function sitePriority(site: ConstructionSite): number {
  const override = Memory.constructionSites?.[site.id]?.priority;
  if (override !== undefined) return override;
  if (site.structureType === STRUCTURE_WALL && isLairWallSpot(site.pos)) return LAIR_WALL_PRIORITY;
  return TYPE_PRIORITY[site.structureType] ?? DEFAULT_PRIORITY;
}

/**
 * Picks a site among the highest-priority ones, spreading drones evenly across them: the one
 * with the fewest drones on it, nearest first. Source containers being built by a stationed
 * drone (see roles/drone.ts) are left to it.
 */
export function pickSite(creep: Creep, sites: ConstructionSite[]): ConstructionSite | null {
  const creeps = homeCreeps(creep.memory.room).filter((c) => c !== creep);
  const stations = new Set(creeps.map((c) => c.memory.station).filter((id) => id !== undefined));
  const open = sites.filter(
    (s) =>
      !(s.structureType === STRUCTURE_CONTAINER && s.pos.findInRange(FIND_SOURCES, 1).some((src) => stations.has(src.id))),
  );
  if (open.length === 0) return null;

  const best = Math.min(...open.map(sitePriority));
  const top = open.filter((s) => sitePriority(s) === best);
  const workers = (s: ConstructionSite) => creeps.filter((c) => c.memory.siteId === s.id).length;
  const fewest = Math.min(...top.map(workers));
  const candidates = top.filter((s) => workers(s) === fewest);
  return creep.pos.findClosestByPath(candidates) ?? candidates[0];
}
