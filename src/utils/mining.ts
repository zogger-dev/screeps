import { bestTier, tierBody } from "./body";
import { homeCreeps } from "./census";
import { sourceContainer } from "./sources";

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
