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
 * Build priority for a site. Override a single site from the console with
 * `Memory.constructionSites["<site id>"] = { priority: 0 }`.
 */
export function sitePriority(site: ConstructionSite): number {
  return Memory.constructionSites?.[site.id]?.priority ?? TYPE_PRIORITY[site.structureType] ?? DEFAULT_PRIORITY;
}

/** Picks the highest-priority site, breaking ties by path distance. */
export function pickSite(creep: Creep, sites: ConstructionSite[]): ConstructionSite | null {
  if (sites.length === 0) return null;
  const best = Math.min(...sites.map(sitePriority));
  const candidates = sites.filter((s) => sitePriority(s) === best);
  return creep.pos.findClosestByPath(candidates) ?? candidates[0];
}
