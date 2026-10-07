import { isSafe, moveSafely, safeSources } from "./safety";
import { hasStaticUpgraders, isCovered } from "./mining";
import { cachedTravelCost, travelCost } from "./paths";
import { controllerContainer, harvestSpots, isSourceContainer } from "./sources";

/**
 * Flips creep.memory.working when the creep fills up or runs dry.
 * Returns true if the creep should be spending energy this tick.
 */
export function updateWorking(creep: Creep): boolean {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
    // Re-pick a source each trip, since the best round trip changes with where the creep is.
    delete creep.memory.sourceId;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  }
  return creep.memory.working;
}

/**
 * Picks the source with the cheapest round trip, creep -> source -> `destination` (where the
 * energy will be spent), among those with a free harvest spot. So nearby sources fill up first
 * and long or swampy walks are only made once they're saturated. If every source is full, picks
 * the one with the most room left. Remembers the choice for the trip, and reassigns if the
 * source is no longer a candidate (e.g. it became dangerous).
 */
function assignSource(creep: Creep, sources: Source[], destination?: () => RoomPosition): Source | null {
  const existing = creep.memory.sourceId && Game.getObjectById(creep.memory.sourceId);
  if (existing && sources.some((s) => s.id === existing.id)) return existing;

  if (sources.length === 0) {
    delete creep.memory.sourceId;
    return null;
  }

  const counts = new Map<Id<Source>, number>(sources.map((s) => [s.id, 0]));
  for (const other of Object.values(Game.creeps)) {
    // Miners occupy a spot too; haulers are tied to a source but never stand on its spots.
    const id = other.memory.type === "miner" ? other.memory.post : other.memory.sourceId;
    if (id && counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  // This creep's own previous claim was cleared at the start of the trip, so it isn't counted.
  const free = (s: Source) => harvestSpots(s) - counts.get(s.id)!;
  const open = sources.filter((s) => free(s) > 0);
  let source: Source;
  if (open.length > 0) {
    const dest = destination?.();
    const trip = (s: Source) => travelCost(creep.pos, s.pos) + (dest ? cachedTravelCost(s.pos, dest) : 0);
    const costs = new Map(open.map((s) => [s.id, trip(s)]));
    source = open.reduce((best, s) => (costs.get(s.id)! < costs.get(best.id)! ? s : best));
  } else {
    source = sources.reduce((best, s) => (free(s) > free(best) ? s : best));
  }
  creep.memory.sourceId = source.id;
  return source;
}

/**
 * Mines the creep's assigned source. `destination` (evaluated only when picking a new source) is
 * where the energy will be spent. Returns false if no candidate source is available.
 */
export function harvestAssignedSource(
  creep: Creep,
  sources = safeSources(creep.room),
  destination?: () => RoomPosition,
): boolean {
  const source = assignSource(creep, sources, destination);
  if (!source) return false;
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
  return true;
}

/**
 * Fills spawns and extensions, then towers, then (if `stockpile`) storage or the controller
 * container. Source containers are skipped: that's where energy comes from, not where it goes.
 * Returns false if there's nowhere to deliver.
 */
export function deliverEnergy(creep: Creep, stockpile = true): boolean {
  const target =
    creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureSpawn | StructureExtension =>
        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) ??
    creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureTower =>
        s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 100,
    }) ??
    (stockpile ? stockpileTarget(creep) : null);
  if (!target) return false;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, target, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
  return true;
}

function stockpileTarget(creep: Creep): StructureContainer | StructureStorage | null {
  return creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer | StructureStorage =>
      (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      !isSourceContainer(s) &&
      isSafe(s.pos),
  });
}

/** Smallest pile worth a detour. Piles under 1000 lose 1 energy per tick wherever they are. */
const MIN_LOOSE_ENERGY = 50;

type LooseEnergy = Resource | Tombstone | Ruin;

const looseAmount = (o: LooseEnergy) => (o instanceof Resource ? o.amount : o.store[RESOURCE_ENERGY]);

/**
 * Closest energy that's decaying where it lies: dropped piles, tombstones (dead and recycled
 * creeps leave their energy in one) and ruins (destroyed structures). These spill or vanish over
 * time, so they're worth grabbing before anything sitting safely in a container.
 */
export function findLooseEnergy(creep: Creep, minAmount = MIN_LOOSE_ENERGY): LooseEnergy | null {
  const candidates: LooseEnergy[] = [
    ...creep.room.find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY }),
    ...creep.room.find(FIND_TOMBSTONES),
    ...creep.room.find(FIND_RUINS),
  ].filter((o) => looseAmount(o) >= minAmount && isSafe(o.pos));
  return creep.pos.findClosestByPath(candidates);
}

/** Picks up a pile, or withdraws from a tombstone, ruin or store, moving there if needed. */
export function takeEnergy(creep: Creep, target: LooseEnergy | StructureContainer | StructureStorage): void {
  const result = target instanceof Resource ? creep.pickup(target) : creep.withdraw(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) moveSafely(creep, target);
}

/**
 * Drone energy: decaying energy (piles, tombstones, ruins), then storage/containers, then mining
 * a source that miners haven't taken over (picked by round trip to `destination`, where the
 * energy will be spent). The controller container is left alone once workers work from it.
 */
export function collectEnergy(creep: Creep, destination?: () => RoomPosition): void {
  const loose = findLooseEnergy(creep);
  if (loose) {
    takeEnergy(creep, loose);
    return;
  }

  const reserved = hasStaticUpgraders(creep.memory.room) ? controllerContainer(creep.room)?.id : undefined;
  const store = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer | StructureStorage =>
      (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
      s.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity() &&
      s.id !== reserved &&
      isSafe(s.pos),
  });
  if (store) {
    takeEnergy(creep, store);
    return;
  }

  harvestAssignedSource(creep, safeSources(creep.room).filter((s) => !isCovered(s)), destination);
}
