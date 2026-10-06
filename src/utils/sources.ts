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
