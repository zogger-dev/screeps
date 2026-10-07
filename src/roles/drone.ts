import { deliverEnergy, findLooseEnergy, takeEnergy, updateWorking } from "../utils/energy";
import { moveSafely } from "../utils/safety";
import type { RoleDef } from "./index";

/** Decaying energy within this range is worth a short detour while loading. */
const NEARBY = 3;

/** Loads at the route's supply, after grabbing any decaying energy lying close by. */
function load(creep: Creep, route: Route | undefined): void {
  const loose = findLooseEnergy(creep, undefined, NEARBY);
  if (loose) {
    takeEnergy(creep, loose);
    return;
  }

  const from = route && Game.getObjectById(route.from);
  if (!from) {
    loadAnywhere(creep);
  } else if (from instanceof Source) {
    if (creep.harvest(from) === ERR_NOT_IN_RANGE) {
      moveSafely(creep, from, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
  } else {
    takeEnergy(creep, from);
  }
}

/**
 * No route: the plan had no supply left for this drone, and it's about to be recycled (or is
 * kept as one of minDrones). Picks up decaying energy only; mining would crowd planned drones.
 */
function loadAnywhere(creep: Creep): void {
  const loose = findLooseEnergy(creep);
  if (loose) takeEnergy(creep, loose);
}

/** Spends the load on the route's sink, or upgrades if the sink no longer needs it. */
function spend(creep: Creep, route: Route | undefined): void {
  const target = route?.target && Game.getObjectById(route.target);
  switch (route?.kind) {
    case "fill": {
      // Drones don't stockpile; containers and storage are the haulers' job.
      if (deliverEnergy(creep, false)) return;
      // Spawn's full for now; it'll need this load soon, so wait nearby rather than wander off.
      const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
      if (spawn && !creep.pos.inRangeTo(spawn, 3)) moveSafely(creep, spawn, { range: 3 });
      return;
    }
    case "tower":
      if (target instanceof StructureTower && target.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveSafely(creep, target);
        return;
      }
      break;
    case "build":
      if (target instanceof ConstructionSite) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          moveSafely(creep, target, { range: 3, visualizePathStyle: { stroke: "#ffffff" } });
        }
        return;
      }
      break;
    case "repair":
      if (target instanceof Structure && target.hits < target.hitsMax) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          moveSafely(creep, target, { range: 3, visualizePathStyle: { stroke: "#00ff00" } });
        }
        return;
      }
      break;
  }
  // Upgrade routes, and sinks that ran out mid-load: the next plan will reassign us.
  const controller = creep.room.controller;
  if (controller?.my && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, controller, { range: 3, visualizePathStyle: { stroke: "#ffffff" } });
  }
}

/**
 * All-rounder: runs the route the logistics planner gave it (managers/logistics.ts), loading at
 * the route's supply and spending on its sink. Covers for missing miners and workers, since the
 * planner routes drones to sources without a miner and to the controller when nobody upgrades.
 */
export const drone: RoleDef = {
  run(creep) {
    const route = creep.memory.route;
    if (updateWorking(creep)) spend(creep, route);
    else load(creep, route);
  },
};
