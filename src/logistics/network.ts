import { bodyCost } from "../bodies";
import { homeCreeps } from "../utils/census";
import { sitePriority } from "../utils/construction";
import { sourceIncome } from "../utils/mining";
import { cachedTravelCost } from "../utils/paths";
import { needsRepair } from "../utils/repair";
import { isSafe, safeSources } from "../utils/safety";
import { controllerContainer, harvestSpots } from "../utils/sources";
import { isWall } from "../utils/terrain";
import { laneWidth } from "./lanes";

/**
 * Ticks over which the spawn's refill shortfall is spread. Spawning drains it constantly, so the
 * shortfall swings every tick; the steady need is the upkeep, and the shortfall is a slow top-up
 * on top of it, so the plan doesn't lurch with every spawn.
 */
const SPAWN_REFILL_HORIZON = 300;
/** Ticks over which a tower's shortfall is spread: towers defend, so they're refilled quickly. */
const TOWER_REFILL_HORIZON = 50;
/** Ticks over which a stockpile is spread when turned into a supply rate. */
const STORE_HORIZON = 100;
/** Ticks over which construction and repair work is spread, so one big site doesn't take every drone. */
const WORK_HORIZON = 300;
/** Upgrade rate kept ahead of construction while no workers upgrade or the controller nears downgrade. */
const MIN_UPGRADE_RATE = 1;
/** Below this fraction of the full downgrade timer, the minimum upgrade rate kicks in regardless. */
const DOWNGRADE_GUARD = 0.5;
/** Only the most damaged structures become repair sinks, to keep the network small. */
const MAX_REPAIR_SINKS = 5;

/** Sink priorities; lower is served first. Construction adds the site's own build priority. */
const PRIORITY = { fill: 0, tower: 1, minUpgrade: 2, build: 10, repair: 50, upgrade: 100 };

/** Where drones load energy: a Source they harvest, or a store they withdraw from. */
export interface Supply {
  id: Id<Source | StructureContainer | StructureStorage>;
  kind: "source" | "store";
  pos: RoomPosition;
  /** Energy per tick available to drones. */
  rate: number;
  /** Tiles drones can load from: harvest spots for a Source, walkable neighbours for a store. */
  spots: number;
}

/** Where drones spend energy. */
export interface Sink {
  /** Unique within the room; two sinks can share a kind and target (the two upgrade sinks). */
  key: string;
  kind: SinkKind;
  target?: Id<RouteTarget>;
  pos: RoomPosition;
  /** Range the drone works from. */
  range: number;
  /** Energy one WORK part spends here per tick; 0 for plain transfers. */
  workPerPart: number;
  priority: number;
  /** Energy per tick wanted; Infinity for the controller, which takes whatever is left. */
  demand: number;
  /** A job that ends (a construction site, a repair), rather than an ongoing need. */
  finite?: boolean;
}

export interface Network {
  supplies: Supply[];
  sinks: Sink[];
  /** Lanes through a tile (see logistics/lanes.ts): how much traffic it can carry. */
  lanes(x: number, y: number): number;
}

/** Energy per tick each source's haulers move to the base, from their CARRY and round trip. */
function haulerRates(creeps: Creep[], spawn: StructureSpawn | undefined): Map<Id<Source>, number> {
  const rates = new Map<Id<Source>, number>();
  if (!spawn) return rates;
  for (const hauler of creeps) {
    const source = hauler.memory.type === "hauler" && hauler.memory.post && Game.getObjectById(hauler.memory.post);
    if (!source) continue;
    const trip = 2 * cachedTravelCost(source.pos, spawn.pos) + 2;
    rates.set(source.id, (rates.get(source.id) ?? 0) + hauler.store.getCapacity(RESOURCE_ENERGY) / trip);
  }
  return rates;
}

/** Walkable tiles next to a structure: how many creeps can reach it at once. */
function accessTiles(structure: Structure): number {
  const terrain = structure.room.getTerrain();
  let tiles = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = structure.pos.x + dx;
      const y = structure.pos.y + dy;
      if ((!dx && !dy) || x < 0 || x > 49 || y < 0 || y > 49 || isWall(terrain, x, y)) continue;
      const blocked = structure.room
        .lookForAt(LOOK_STRUCTURES, x, y)
        .some((s) => (OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType));
      if (!blocked) tiles++;
    }
  }
  return tiles;
}

function supplies(room: Room, creeps: Creep[], hauled: Map<Id<Source>, number>): Supply[] {
  const result: Supply[] = [];
  const mined = new Set(creeps.filter((c) => c.memory.type === "miner").map((c) => c.memory.post));
  for (const s of safeSources(room)) {
    if (mined.has(s.id)) continue;
    result.push({ id: s.id, kind: "source", pos: s.pos, rate: sourceIncome(s), spots: harvestSpots(s) });
  }

  // The controller container belongs to the workers once they're upgrading from it.
  const reserved = creeps.some((c) => c.memory.type === "worker") ? controllerContainer(room)?.id : undefined;
  const stores = room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer | StructureStorage =>
      (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
      s.id !== reserved &&
      isSafe(s.pos),
  });
  for (const store of stores) {
    // A source container also refills from its miner, less what its haulers take away.
    const source = store.pos.findInRange(FIND_SOURCES, 1)[0];
    const inflow = source && mined.has(source.id) ? Math.max(0, sourceIncome(source) - (hauled.get(source.id) ?? 0)) : 0;
    const rate = store.store[RESOURCE_ENERGY] / STORE_HORIZON + inflow;
    if (rate > 0) result.push({ id: store.id, kind: "store", pos: store.pos, rate, spots: accessTiles(store) });
  }
  return result;
}

function sinks(room: Room, creeps: Creep[], hauled: number): Sink[] {
  const result: Sink[] = [];
  const spawn = room.find(FIND_MY_SPAWNS)[0];

  // Spawn and extensions as one pseudo-node at the spawn: the shortfall plus the energy spawning
  // replacements costs on average, less what haulers already bring.
  const upkeep = creeps.reduce((sum, c) => sum + bodyCost(c.body.map((p) => p.type)), 0) / CREEP_LIFE_TIME;
  const fill = (room.energyCapacityAvailable - room.energyAvailable) / SPAWN_REFILL_HORIZON + upkeep - hauled;
  if (spawn && fill > 0) {
    result.push({ key: "fill", kind: "fill", pos: spawn.pos, range: 1, workPerPart: 0, priority: PRIORITY.fill, demand: fill });
  }

  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 100,
  });
  for (const t of towers) {
    const demand = t.store.getFreeCapacity(RESOURCE_ENERGY) / TOWER_REFILL_HORIZON;
    result.push({ key: `tower:${t.id}`, kind: "tower", target: t.id, pos: t.pos, range: 1, workPerPart: 0, priority: PRIORITY.tower, demand });
  }

  const controller = room.controller;
  const upgrade = { kind: "upgrade" as const, range: 3, workPerPart: UPGRADE_CONTROLLER_POWER };
  if (controller?.my) {
    const downgrading = controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[controller.level] * DOWNGRADE_GUARD;
    if (downgrading || !creeps.some((c) => c.memory.type === "worker")) {
      result.push({ ...upgrade, key: "upgrade:min", pos: controller.pos, priority: PRIORITY.minUpgrade, demand: MIN_UPGRADE_RATE });
    }
  }

  for (const site of room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => isSafe(s.pos) })) {
    result.push({
      key: `build:${site.id}`,
      kind: "build",
      target: site.id,
      pos: site.pos,
      range: 3,
      workPerPart: BUILD_POWER,
      priority: PRIORITY.build + sitePriority(site),
      demand: (site.progressTotal - site.progress) / WORK_HORIZON,
      finite: true,
    });
  }

  const damaged = room
    .find(FIND_STRUCTURES, { filter: (s) => needsRepair(s) && isSafe(s.pos) })
    .sort((a, b) => b.hitsMax - b.hits - (a.hitsMax - a.hits))
    .slice(0, MAX_REPAIR_SINKS);
  for (const s of damaged) {
    result.push({
      key: `repair:${s.id}`,
      kind: "repair",
      target: s.id,
      pos: s.pos,
      range: 3,
      workPerPart: REPAIR_POWER * REPAIR_COST,
      priority: PRIORITY.repair,
      demand: ((s.hitsMax - s.hits) * REPAIR_COST) / WORK_HORIZON,
      finite: true,
    });
  }

  if (controller?.my) {
    result.push({ ...upgrade, key: "upgrade", pos: controller.pos, priority: PRIORITY.upgrade, demand: Infinity });
  }
  return result;
}

/**
 * The room's energy network as drones see it: supplies they can load from and sinks they can
 * spend on, with rates in energy per tick. Miners, haulers and workers aren't planned yet; their
 * flows are subtracted (haulers feeding the spawn, miners feeding containers) so drones fill the
 * rest.
 */
export function buildNetwork(room: Room): Network {
  const creeps = homeCreeps(room.name);
  const hauled = haulerRates(creeps, room.find(FIND_MY_SPAWNS)[0]);
  const totalHauled = [...hauled.values()].reduce((a, b) => a + b, 0);
  return {
    supplies: supplies(room, creeps, hauled),
    sinks: sinks(room, creeps, totalHauled),
    lanes: (x, y) => laneWidth(room.name, x, y),
  };
}
