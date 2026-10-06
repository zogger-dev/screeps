import { moveSafely } from "../utils/safety";

/**
 * Creep side of retirement: walk to a home spawn, hand over any carried energy, and get recycled.
 * Recycling drops part of the creep's cost (more the younger it is) next to the spawn.
 * Returns true while the creep is retiring and its role shouldn't run.
 */
export function runRetirement(creep: Creep): boolean {
  if (!creep.memory.retiring) return false;

  const spawns = Game.rooms[creep.memory.room]?.find(FIND_MY_SPAWNS) ?? [];
  const spawn = creep.pos.findClosestByPath(spawns) ?? spawns[0];
  if (!spawn) {
    // Nowhere to recycle; go back to work rather than wander.
    creep.memory.retiring = false;
    return false;
  }

  if (!creep.pos.isNearTo(spawn)) {
    moveSafely(creep, spawn, { visualizePathStyle: { stroke: "#888888" } });
  } else if (creep.store[RESOURCE_ENERGY] > 0 && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    creep.transfer(spawn, RESOURCE_ENERGY);
  } else {
    spawn.recycleCreep(creep);
  }
  return true;
}
