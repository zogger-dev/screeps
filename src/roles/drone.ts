import { homeCreeps } from "../utils/census";
import { pickSite, sitePriority } from "../utils/construction";
import { collectEnergy, deliverEnergy, harvestAssignedSource, updateWorking } from "../utils/energy";
import { needsRepair } from "../utils/repair";
import { isSafe, moveSafely } from "../utils/safety";
import type { RoleDef } from "./index";

/** Below this fraction of the full downgrade timer, upgrading jumps the queue. */
const DOWNGRADE_GUARD = 0.5;

/** Spawn, extensions and towers. Workers don't stockpile; that's the haulers' job. */
function fill(creep: Creep): boolean {
  return deliverEnergy(creep, false);
}

/** Sticks with its site until it's done or a higher-priority site appears. */
function build(creep: Creep): boolean {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => isSafe(s.pos) });
  const current = creep.memory.siteId && Game.getObjectById(creep.memory.siteId);
  const outranked = current && sites.some((s) => sitePriority(s) < sitePriority(current));
  const site = current && !outranked ? current : pickSite(creep, sites);
  if (!site) {
    delete creep.memory.siteId;
    return false;
  }
  creep.memory.siteId = site.id;
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

/**
 * The container site at this drone's source, if it's the one drone stationed there to build it.
 * Claims the station if nobody else has. Releases it once the container is done.
 */
function stationSite(creep: Creep): ConstructionSite | null {
  const sourceId = creep.memory.sourceId;
  const source = sourceId && Game.getObjectById(sourceId);
  const site = source
    ? source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER })[0]
    : undefined;
  // Same one-tile margin as safeSources: the drone stands next to the source.
  if (!source || !site || !isSafe(source.pos, 1)) {
    delete creep.memory.station;
    return null;
  }
  if (creep.memory.station !== source.id) {
    const taken = homeCreeps(creep.memory.room).some((c) => c !== creep && c.memory.station === source.id);
    if (taken) return null;
    creep.memory.station = source.id;
  }
  return site;
}

/**
 * Stationed drone: harvests and builds its source's container from the same spot, with no
 * transit at all, until the container is done.
 */
function buildStation(creep: Creep, site: ConstructionSite): void {
  if (!updateWorking(creep)) {
    harvestAssignedSource(creep, [Game.getObjectById(creep.memory.station!)!]);
  } else if (creep.build(site) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, site);
  }
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
    const station = stationSite(creep);
    if (station) {
      buildStation(creep, station);
      return;
    }

    if (!updateWorking(creep)) {
      delete creep.memory.task;
      collectEnergy(creep, () => expectedDestination(creep));
      return;
    }

    if (!creep.memory.task) {
      creep.memory.task = pickTask(creep);
      // Only count towards a site's builders while actually building it.
      if (creep.memory.task !== "build") delete creep.memory.siteId;
    }
    const task = creep.memory.task;
    if (!TASKS[task](creep)) {
      // The task ran out (site finished, spawn full): upgrade this tick and re-pick next tick.
      delete creep.memory.task;
      upgrade(creep);
    }
  },
};
