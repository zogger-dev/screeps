import { isSafe, moveSafely } from "./safety";
import { isSourceContainer } from "./sources";

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
 * Closest energy that's decaying where it lies, within `maxRange`: dropped piles, tombstones (dead
 * and recycled creeps leave their energy in one) and ruins (destroyed structures). These spill or
 * vanish over time, so they're worth grabbing before anything sitting safely in a container.
 */
export function findLooseEnergy(creep: Creep, minAmount = MIN_LOOSE_ENERGY, maxRange = Infinity): LooseEnergy | null {
  const candidates: LooseEnergy[] = [
    ...creep.room.find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY }),
    ...creep.room.find(FIND_TOMBSTONES),
    ...creep.room.find(FIND_RUINS),
  ].filter((o) => looseAmount(o) >= minAmount && creep.pos.getRangeTo(o) <= maxRange && isSafe(o.pos));
  return creep.pos.findClosestByPath(candidates);
}

/** Picks up a pile, or withdraws from a tombstone, ruin or store, moving there if needed. */
export function takeEnergy(creep: Creep, target: LooseEnergy | StructureContainer | StructureStorage): void {
  const result = target instanceof Resource ? creep.pickup(target) : creep.withdraw(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) moveSafely(creep, target);
}
