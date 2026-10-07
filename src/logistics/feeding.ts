/** Sinks a drone works at (rather than just dropping energy off). */
const WORK_KINDS: SinkKind[] = ["build", "repair", "upgrade"];
/** A working creep is worth a hauler's visit once it's down to this share of its capacity. */
const HUNGRY_SHARE = 0.5;

/** The site a drone on a work route works at: its target, or the controller when upgrading. */
function workSite(creep: Creep): RoomObject | null {
  const route = creep.memory.route;
  if (!route || !WORK_KINDS.includes(route.kind)) return null;
  if (route.kind === "upgrade") return creep.room.controller ?? null;
  return route.target ? Game.getObjectById(route.target) : null;
}

/**
 * True if a hauler should top this creep up: a drone at its work site (in range of it, working or
 * just run dry) or an upgrade worker, down to `share` of its capacity. Topping it up means it
 * never walks back to a supply.
 */
export function isHungry(creep: Creep, share = HUNGRY_SHARE): boolean {
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY);
  if (!capacity || creep.store[RESOURCE_ENERGY] >= capacity * share) return false;
  if (creep.memory.type === "worker") return true;
  if (creep.memory.type !== "drone") return false;
  const site = workSite(creep);
  return site !== null && creep.pos.inRangeTo(site, 3);
}

/** The hungriest creep working at a site that isn't in `claimed`, nearest first. */
export function pickHungry(hauler: Creep, claimed: Set<string>): Creep | undefined {
  const share = (c: Creep) => c.store[RESOURCE_ENERGY] / c.store.getCapacity(RESOURCE_ENERGY);
  return hauler.room
    .find(FIND_MY_CREEPS, { filter: (c) => !claimed.has(c.name) && isHungry(c) })
    .sort((a, b) => share(a) - share(b) || hauler.pos.getRangeTo(a) - hauler.pos.getRangeTo(b))[0];
}

/** Rough ticks per plain tile for a creep: its fatigue-generating parts over its MOVE parts. */
function ticksPerTile(creep: Creep, loaded: boolean): number {
  const weight = creep.body.filter(
    (p) => p.hits > 0 && p.type !== MOVE && (loaded || p.type !== CARRY),
  ).length;
  return Math.max(1, Math.ceil(weight / Math.max(1, creep.getActiveBodyparts(MOVE))));
}

/**
 * True if a loaded hauler is on its way to feed this creep and will get there sooner than the
 * creep could reload itself: walking to its supply empty, loading, and walking back full.
 */
export function feederComing(creep: Creep): boolean {
  const feeders = creep.room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.dropoff?.kind === "feed" && c.memory.dropoff.id === creep.name && c.store[RESOURCE_ENERGY] > 0,
  });
  if (feeders.length === 0) return false;
  const arrival = Math.min(...feeders.map((h) => (h.pos.getRangeTo(creep) - 1) * ticksPerTile(h, true)));

  const supply = creep.memory.route && Game.getObjectById(creep.memory.route.from);
  if (!supply) return true; // nowhere to reload from anyway
  const distance = creep.pos.getRangeTo(supply);
  const work = Math.max(1, creep.getActiveBodyparts(WORK));
  const loading = supply instanceof Source ? Math.ceil(creep.store.getCapacity(RESOURCE_ENERGY) / (work * HARVEST_POWER)) : 1;
  const reload = distance * ticksPerTile(creep, false) + loading + distance * ticksPerTile(creep, true);
  return arrival < reload;
}
