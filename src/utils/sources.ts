const spotCache = new Map<Id<Source>, number>();

/** Number of walkable tiles adjacent to a source, i.e. how many creeps can harvest it at once. */
export function harvestSpots(source: Source): number {
  let spots = spotCache.get(source.id);
  if (spots === undefined) {
    // Terrain never changes, so this only needs computing once per global reset.
    const terrain = source.room.getTerrain();
    spots = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if ((dx || dy) && terrain.get(source.pos.x + dx, source.pos.y + dy) !== TERRAIN_MASK_WALL) spots++;
      }
    }
    spotCache.set(source.id, spots);
  }
  return spots;
}

/** The container next to a source, where a static miner sits. */
export function sourceContainer(source: Source): StructureContainer | undefined {
  return source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
  })[0];
}

export function isSourceContainer(s: Structure): boolean {
  return s.structureType === STRUCTURE_CONTAINER && s.pos.findInRange(FIND_SOURCES, 1).length > 0;
}

/** The container within upgrade range of the controller, where static upgraders work. */
export function controllerContainer(room: Room): StructureContainer | undefined {
  return room.controller?.pos.findInRange(FIND_STRUCTURES, 3, {
    filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER && !isSourceContainer(s),
  })[0];
}
