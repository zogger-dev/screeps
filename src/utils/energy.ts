import { isSafe, moveSafely, safeSources } from "./safety";
import { hasStaticUpgraders, isCovered } from "./mining";
import { controllerContainer, harvestSpots, isSourceContainer } from "./sources";

/**
 * Flips creep.memory.working when the creep fills up or runs dry.
 * Returns true if the creep should be spending energy this tick.
 */
export function updateWorking(creep: Creep): boolean {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  }
  return creep.memory.working;
}

/**
 * Picks the candidate source with the most unclaimed harvest spots and remembers it.
 * Reassigns if the remembered source is no longer a candidate (e.g. it became dangerous).
 */
function assignSource(creep: Creep, sources: Source[]): Source | null {
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
  const free = (s: Source) => harvestSpots(s) - counts.get(s.id)!;
  const source = sources.reduce((best, s) => (free(s) > free(best) ? s : best));
  creep.memory.sourceId = source.id;
  return source;
}

/** Mines the creep's assigned source. Returns false if no candidate source is available. */
export function harvestAssignedSource(creep: Creep, sources = safeSources(creep.room)): boolean {
  const source = assignSource(creep, sources);
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
 * a source that miners haven't taken over. The controller container is left alone once workers
 * work from it.
 */
export function collectEnergy(creep: Creep): void {
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

  harvestAssignedSource(creep, safeSources(creep.room).filter((s) => !isCovered(s)));
}
