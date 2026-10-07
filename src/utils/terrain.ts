/**
 * True if the tile is a natural wall. Terrain is a bitmask (plain 0, wall 1, swamp 2), and some
 * rooms have tiles marked wall + swamp (3), so test the bit rather than compare.
 */
export function isWall(terrain: RoomTerrain, x: number, y: number): boolean {
  return (terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0;
}
