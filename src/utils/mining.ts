import { bestTier, tierBody } from "../bodies";
import { homeCreeps } from "./census";
import { cachedTravelCost } from "./paths";
import { harvestSpots, sourceContainer } from "./sources";

/** Extra hauling capacity on top of the exact requirement, to absorb traffic and refill waits. */
const HAUL_SLACK = 1.2;

/**
 * A source switches from drones to a miner once the room can afford one and the source's
 * container is built, so the miner can start working the moment it arrives.
 */
export function isStaticSource(source: Source): boolean {
  return bestTier("miner", source.room.energyCapacityAvailable) >= 0 && sourceContainer(source) !== undefined;
}

/** Energy a fully mined source yields per tick. */
export function sourceIncome(source: Source): number {
  return source.energyCapacity / ENERGY_REGEN_TIME;
}

const distanceCache = new Map<Id<Source>, number>();

/** Path length from the room's first spawn to the source. Cached per global reset. */
function haulDistance(source: Source): number {
  let distance = distanceCache.get(source.id);
  if (distance === undefined) {
    const spawn = source.room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return 0;
    distance = PathFinder.search(spawn.pos, { pos: source.pos, range: 1 }, { maxRooms: 1 }).path.length;
    distanceCache.set(source.id, distance);
  }
  return distance;
}

/** Enough haulers to move everything a source produces during one round trip. */
export function haulersNeeded(source: Source): number {
  const tier = Math.max(0, bestTier("hauler", source.room.energyCapacityAvailable));
  const capacity = tierBody("hauler", tier).filter((p) => p === CARRY).length * CARRY_CAPACITY;
  return Math.max(1, Math.ceil((sourceIncome(source) * 2 * haulDistance(source) * HAUL_SLACK) / capacity));
}

/**
 * How many drones a source can keep busy. A drone mines until its CARRY is full, then leaves on a
 * round trip, freeing its spot for another. So a source supports spots x cycle / mining time
 * drones before they queue for spots, and regen x cycle / CARRY before they drain it faster than
 * it refills. The round trip is estimated to the spawn.
 *
 * While the source's container is a construction site, one drone is stationed there building it
 * (see roles/drone.ts): it holds a spot full-time and draws up to its mining rate, and the rest
 * share what's left. On a single-spot source that reserves the source for the builder.
 */
export function droneCapacity(source: Source): number {
  const room = source.room;
  const body = tierBody("drone", Math.max(0, bestTier("drone", room.energyCapacityAvailable)));
  const work = body.filter((p) => p === WORK).length;
  const carry = body.filter((p) => p === CARRY).length * CARRY_CAPACITY;
  const miningRate = work * HARVEST_POWER;

  const stationed = hasContainerSite(source) ? 1 : 0;
  const spots = harvestSpots(source) - stationed;
  const regen = sourceIncome(source) - stationed * miningRate;
  if (spots <= 0 || regen <= 0) return stationed;

  const miningTicks = Math.ceil(carry / miningRate);
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  // Path cost uses plain = 2, which is about how many ticks a drone takes per plain tile.
  const roundTrip = spawn ? 2 * cachedTravelCost(source.pos, spawn.pos) : 0;
  const cycle = miningTicks + roundTrip;

  const bySpots = Math.floor((spots * cycle) / miningTicks);
  const byEnergy = Math.floor((regen * cycle) / carry);
  return stationed + Math.max(stationed ? 0 : 1, Math.min(bySpots, byEnergy));
}

function hasContainerSite(source: Source): boolean {
  return (
    source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    }).length > 0
  );
}

/** True once a static source has its miner and enough haulers, so drones can stop harvesting it. */
export function isCovered(source: Source): boolean {
  if (!isStaticSource(source)) return false;
  const assigned = homeCreeps(source.room.name).filter((c) => c.memory.post === source.id);
  return (
    assigned.some((c) => c.memory.type === "miner") &&
    assigned.filter((c) => c.memory.type === "hauler").length >= haulersNeeded(source)
  );
}

/** True if workers are upgrading from the controller container. */
export function hasStaticUpgraders(roomName: string): boolean {
  return homeCreeps(roomName).some((c) => c.memory.type === "worker");
}
