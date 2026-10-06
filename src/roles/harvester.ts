import { harvestAssignedSource, updateWorking } from "../utils/energy";
import { isSafe, moveSafely } from "../utils/safety";
import { builder } from "./builder";
import type { RoleDef } from "./index";

/** Mines a source and keeps spawns, extensions and towers filled, then stockpiles in containers/storage. */
export const harvester: RoleDef = {
  run(creep) {
    if (!updateWorking(creep)) {
      harvestAssignedSource(creep);
      return;
    }

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
      // Stockpile for upgraders and builders so they don't have to mine sources themselves.
      creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s): s is StructureContainer | StructureStorage =>
          (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
          isSafe(s.pos),
      });

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        moveSafely(creep, target, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
      return;
    }

    // Everything is full; make ourselves useful instead of idling.
    builder.run(creep);
  },
};
