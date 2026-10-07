import { isWall } from "./terrain";

/**
 * Keepers spawn on their lair's own tile, their only goal is to stand next to a nearby source,
 * and they never attack structures (see the engine's keeper-lairs/tick.js and keepers/pretick.js).
 * So walling every walkable tile around a lair traps each new keeper on the lair forever, where
 * it can only hit creeps within its ranged-attack reach. This only works in rooms we own; real
 * Source Keeper rooms can't be claimed, so walls can't be built there.
 */

const KEEPER_OWNER = "Source Keeper";
/** Keepers guard any source within this range of their lair (engine: keepers/pretick.js). */
const KEEPER_GUARD_RANGE = 5;
/** A keeper parks next to its source and shoots 3 tiles, so it reaches this far from the source. */
const KEEPER_REACH = 4;

const isObstacle = (s: Structure) => (OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType);

export function keeperLairs(room: Room): StructureKeeperLair[] {
  return room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureKeeperLair => s.structureType === STRUCTURE_KEEPER_LAIR,
  });
}

/** Walkable tiles around a lair: the ones a keeper could step out through. */
export function lairWallSpots(lair: StructureKeeperLair): RoomPosition[] {
  const terrain = lair.room.getTerrain();
  const spots: RoomPosition[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = lair.pos.x + dx;
      const y = lair.pos.y + dy;
      if ((dx || dy) && x >= 1 && x <= 48 && y >= 1 && y <= 48 && !isWall(terrain, x, y)) {
        spots.push(new RoomPosition(x, y, lair.room.name));
      }
    }
  }
  return spots;
}

/** True once every way out of the lair is blocked by a wall (or any other obstacle structure). */
export function isEnclosed(lair: StructureKeeperLair): boolean {
  return lairWallSpots(lair).every((pos) => pos.lookFor(LOOK_STRUCTURES).some(isObstacle));
}

let openCacheTick = -1;
const openCache = new Map<string, StructureKeeperLair[]>();

/** Lairs not yet walled in, whose keepers can still roam to their source. Cached per tick. */
function openLairs(room: Room): StructureKeeperLair[] {
  if (openCacheTick !== Game.time) {
    openCache.clear();
    openCacheTick = Game.time;
  }
  let lairs = openCache.get(room.name);
  if (!lairs) {
    lairs = keeperLairs(room).filter((l) => !isEnclosed(l));
    openCache.set(room.name, lairs);
  }
  return lairs;
}

/** True if a keeper from a lair that isn't walled in yet guards this source. */
export function isGuardedByOpenLair(source: Source): boolean {
  return openLairs(source.room).some((l) => l.pos.inRangeTo(source, KEEPER_GUARD_RANGE));
}

/**
 * True if `pos` is in reach of a keeper whose lair isn't walled in yet: around the lair, or
 * around the source it guards. Such tiles are only safe between keeper lives, so nothing
 * permanent should be built or planned there until the lair is enclosed.
 */
export function isContested(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return false;
  return openLairs(room).some(
    (lair) =>
      lair.pos.inRangeTo(pos, KEEPER_GUARD_RANGE) ||
      lair.pos.findInRange(FIND_SOURCES, KEEPER_GUARD_RANGE).some((s) => s.pos.inRangeTo(pos, KEEPER_REACH)),
  );
}

/** A Source Keeper standing on an enclosed lair: it can't move, so it only threatens what's within reach. */
export function isTrappedKeeper(creep: Creep): boolean {
  if (creep.owner.username !== KEEPER_OWNER) return false;
  const lair = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .find((s): s is StructureKeeperLair => s.structureType === STRUCTURE_KEEPER_LAIR);
  return lair !== undefined && isEnclosed(lair);
}

/** True if `pos` is next to a keeper lair, i.e. a wall there helps trap its keeper. */
export function isLairWallSpot(pos: RoomPosition): boolean {
  return pos.findInRange(FIND_STRUCTURES, 1, { filter: (s) => s.structureType === STRUCTURE_KEEPER_LAIR }).length > 0;
}
