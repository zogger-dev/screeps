import { homeCreeps } from "../utils/census";
import { pickSite } from "../utils/construction";
import { collectEnergy, deliverEnergy, updateWorking } from "../utils/energy";
import { needsRepair } from "../utils/repair";
import { isSafe, moveSafely } from "../utils/safety";
import type { RoleDef } from "./index";

/** Below this fraction of the full downgrade timer, upgrading jumps the queue. */
const DOWNGRADE_GUARD = 0.5;

/** Spawn, extensions and towers. Workers don't stockpile; that's the haulers' job. */
function fill(creep: Creep): boolean {
  return deliverEnergy(creep, false);
}

function build(creep: Creep): boolean {
  const site = pickSite(creep, creep.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => isSafe(s.pos) }));
  if (!site) return false;
  if (creep.build(site) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, site, { visualizePathStyle: { stroke: "#ffffff" } });
  }
  return true;
}

function repair(creep: Creep): boolean {
  const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s) => needsRepair(s) && isSafe(s.pos),
  });
  if (!damaged) return false;
  if (creep.repair(damaged) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, damaged, { visualizePathStyle: { stroke: "#00ff00" } });
  }
  return true;
}

function upgrade(creep: Creep): boolean {
  const controller = creep.room.controller;
  if (!controller?.my) return false;
  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, controller, { visualizePathStyle: { stroke: "#ffffff" } });
  }
  return true;
}

const TASKS: Record<WorkerTask, (creep: Creep) => boolean> = { fill, build, repair, upgrade };

/** Decides what a freshly loaded drone spends its energy on, by what the room needs most. */
function pickTask(creep: Creep): WorkerTask {
  const room = creep.room;
  const creeps = homeCreeps(creep.memory.room);

  // Until haulers exist, drones are the only ones keeping the spawn fed.
  const hasHaulers = creeps.some((c) => c.memory.type === "hauler");
  if (!hasHaulers && room.energyAvailable < room.energyCapacityAvailable) return "fill";

  const controller = room.controller;
  if (controller?.my) {
    const downgrading = controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[controller.level] * DOWNGRADE_GUARD;
    // Keep at least one creep upgrading so the room keeps levelling up during construction.
    const upgrading = creeps.some(
      (c) => c.memory.type === "worker" || c.memory.task === "upgrade",
    );
    if (downgrading || !upgrading) return "upgrade";
  }

  if (room.find(FIND_MY_CONSTRUCTION_SITES).length > 0) return "build";
  if (room.find(FIND_STRUCTURES, { filter: needsRepair }).length > 0) return "repair";
  return "upgrade";
}

/** Where a drone will most likely spend its next load, so it can harvest on the way there. */
function expectedDestination(creep: Creep): RoomPosition {
  const room = creep.room;
  switch (pickTask(creep)) {
    case "build": {
      const site = pickSite(creep, room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => isSafe(s.pos) }));
      if (site) return site.pos;
      break;
    }
    case "upgrade":
      if (room.controller) return room.controller.pos;
      break;
  }
  // Filling, repairs (spread out, usually around the base) and fallbacks: the spawn.
  return room.find(FIND_MY_SPAWNS)[0]?.pos ?? creep.pos;
}

/**
 * All-rounder: gathers energy, then spends each load on whatever the room needs most. Covers for
 * missing miners and workers: it harvests sources without a miner, and upgrades when nobody else is.
 */
export const drone: RoleDef = {
  run(creep) {
    if (!updateWorking(creep)) {
      delete creep.memory.task;
      collectEnergy(creep, () => expectedDestination(creep));
      return;
    }

    const task = creep.memory.task ?? (creep.memory.task = pickTask(creep));
    if (!TASKS[task](creep)) {
      // The task ran out (site finished, spawn full): upgrade this tick and re-pick next tick.
      delete creep.memory.task;
      upgrade(creep);
    }
  },
};
