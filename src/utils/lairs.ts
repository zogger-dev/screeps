/**
 * Keepers spawn on their lair's own tile, their only goal is to stand next to a nearby source,
 * and they never attack structures (see the engine's keeper-lairs/tick.js and keepers/pretick.js).
 * So walling every walkable tile around a lair traps each new keeper on the lair forever, where
 * it can only hit creeps within its ranged-attack reach. This only works in rooms we own; real
 * Source Keeper rooms can't be claimed, so walls can't be built there.
 */

const KEEPER_OWNER = "Source Keeper";

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
      if ((dx || dy) && x >= 1 && x <= 48 && y >= 1 && y <= 48 && terrain.get(x, y) !== TERRAIN_MASK_WALL) {
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
