import { isSafe, moveSafely, safeSources } from "./safety";
import { harvestSpots } from "./sources";

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
 * Picks the safe source with the most unclaimed harvest spots and remembers it.
 * Reassigns if the remembered source has become dangerous.
 */
function assignSource(creep: Creep): Source | null {
  const existing = creep.memory.sourceId && Game.getObjectById(creep.memory.sourceId);
  if (existing && isSafe(existing.pos)) return existing;

  const sources = safeSources(creep.room);
  if (sources.length === 0) {
    delete creep.memory.sourceId;
    return null;
  }

  const counts = new Map<Id<Source>, number>(sources.map((s) => [s.id, 0]));
  for (const other of Object.values(Game.creeps)) {
    const id = other.memory.sourceId;
    if (id && counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  const free = (s: Source) => harvestSpots(s) - counts.get(s.id)!;
  const source = sources.reduce((best, s) => (free(s) > free(best) ? s : best));
  creep.memory.sourceId = source.id;
  return source;
}

export function harvestAssignedSource(creep: Creep): void {
  const source = assignSource(creep);
  if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

/**
 * Gets energy from the cheapest available place: dropped energy, then
 * storage/containers, then mining a source directly.
 */
export function collectEnergy(creep: Creep): void {
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50 && isSafe(r.pos),
  });
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) moveSafely(creep, dropped);
    return;
  }

  const store = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer | StructureStorage =>
      (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
      s.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity() &&
      isSafe(s.pos),
  });
  if (store) {
    if (creep.withdraw(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveSafely(creep, store);
    return;
  }

  harvestAssignedSource(creep);
}
