import { isHungry, pickHungry } from "../logistics/feeding";
import { park } from "../logistics/traffic";
import { findLooseEnergy, stockpileTarget, takeEnergy, updateWorking } from "../utils/energy";
import { moveSafely } from "../utils/safety";
import { sourceContainer } from "../utils/sources";
import type { RoleDef } from "./index";

/** A creep being fed keeps the hauler's attention until it's this full. */
const FED_SHARE = 0.9;

type Pickup = Resource | Tombstone | Ruin | StructureContainer | StructureStorage;

const energyIn = (o: Pickup) => (o instanceof Resource ? o.amount : o.store[RESOURCE_ENERGY]);

/**
 * Where to load next: decaying energy anywhere in the room first, then overflow at its own source
 * (on the way, so any amount), then its source's container.
 */
function choosePickup(creep: Creep, source: Source): Pickup | null {
  const loose = findLooseEnergy(creep);
  if (loose) return loose;
  const overflow = source.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY,
  })[0];
  if (overflow) return overflow;
  const container = sourceContainer(source);
  return container && container.store[RESOURCE_ENERGY] > 0 ? container : null;
}

/** Loads from its committed pickup, choosing a new one only once that's empty or gone. */
function load(creep: Creep): void {
  const source = creep.memory.post && Game.getObjectById(creep.memory.post);
  if (!source) return;

  let target = creep.memory.pickup ? Game.getObjectById(creep.memory.pickup) : null;
  if (!target || energyIn(target) === 0) {
    target = choosePickup(creep, source);
    creep.memory.pickup = target?.id;
  }
  // Nothing to load: wait nearby, outside any choke, without blocking the miner's spot.
  if (!target) park(creep, source.pos);
  else takeEnergy(creep, target);
}

/** What a committed dropoff points at, if it still needs energy. */
function resolve(dropoff: Dropoff): Structure | Creep | null {
  if (dropoff.kind === "feed") {
    const creep = Game.creeps[dropoff.id];
    return creep && isHungry(creep, FED_SHARE) ? creep : null;
  }
  const structure = Game.getObjectById(dropoff.id as Id<StructureSpawn | StructureExtension | StructureTower | StructureContainer | StructureStorage>);
  return structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ? structure : null;
}

/**
 * Next delivery, by priority: the spawn and extensions, towers, then stocking the controller
 * container or storage, then feeding a creep working at a site. Skips spawns, extensions, towers
 * and creeps another hauler is already headed for.
 */
function chooseDropoff(creep: Creep): Dropoff | null {
  const claimed = new Set(
    creep.room
      .find(FIND_MY_CREEPS, { filter: (c) => c !== creep && c.memory.dropoff !== undefined })
      .map((c) => c.memory.dropoff!.id),
  );
  const fill =
    creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        !claimed.has(s.id),
    }) ??
    creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 100 && !claimed.has(s.id),
    });
  if (fill) return { kind: "fill", id: fill.id };
  const stock = stockpileTarget(creep);
  if (stock) return { kind: "stock", id: stock.id };
  const hungry = pickHungry(creep, claimed);
  return hungry ? { kind: "feed", id: hungry.name } : null;
}

/** Delivers to its committed dropoff, choosing a new one only once that's satisfied or gone. */
function deliver(creep: Creep): void {
  let target = creep.memory.dropoff ? resolve(creep.memory.dropoff) : null;
  if (!target) {
    const dropoff = chooseDropoff(creep);
    creep.memory.dropoff = dropoff ?? undefined;
    target = dropoff ? resolve(dropoff) : null;
  }
  if (!target) {
    // Nothing needs energy right now: wait by the spawn, out of any choke, ready for the next refill.
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) park(creep, spawn.pos);
    return;
  }
  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    moveSafely(creep, target, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

/**
 * Carries energy from its source to where it's needed. Commits to one pickup and one dropoff at a
 * time and only re-decides once that one's done, so it doesn't flip between targets as the room
 * changes around it.
 */
export const hauler: RoleDef = {
  run(creep) {
    if (updateWorking(creep)) {
      delete creep.memory.pickup;
      deliver(creep);
    } else {
      delete creep.memory.dropoff;
      load(creep);
    }
  },
};
