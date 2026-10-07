import { isWall } from "../utils/terrain";

/** Wider than this many lanes, traffic is effectively unconstrained. */
export const MAX_LANES = 5;
/** Tiles at most this many lanes wide are chokes: creeps pass through them but never stop in them. */
export const CHOKE_LANES = 3;
/** Structures get built over time; recompute widths this often. */
const REFRESH_TICKS = 500;

const cache = new Map<string, { tick: number; widths: Uint8Array }>();

/** The four axes through a tile: horizontal, vertical and both diagonals. */
const AXES: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function computeWidths(room: Room): Uint8Array {
  const terrain = room.getTerrain();
  const blocked = new Uint8Array(2500);
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) if (isWall(terrain, x, y)) blocked[x * 50 + y] = 1;
  for (const s of room.find(FIND_STRUCTURES)) {
    if ((OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType)) blocked[s.pos.x * 50 + s.pos.y] = 1;
  }
  const open = (x: number, y: number) => x >= 0 && x < 50 && y >= 0 && y < 50 && !blocked[x * 50 + y];

  const widths = new Uint8Array(2500);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (!open(x, y)) continue;
      let width = MAX_LANES;
      for (const [dx, dy] of AXES) {
        let run = 1;
        for (let i = 1; run < MAX_LANES && open(x + dx * i, y + dy * i); i++) run++;
        for (let i = 1; run < MAX_LANES && open(x - dx * i, y - dy * i); i++) run++;
        width = Math.min(width, run);
      }
      widths[x * 50 + y] = width;
    }
  }
  return widths;
}

/**
 * How many creeps can pass a tile side by side: the narrowest open run through it along any of
 * the four axes, i.e. the passage's cross-section, capped at MAX_LANES. 0 for walls and obstacles.
 */
export function laneWidth(roomName: string, x: number, y: number): number {
  const room = Game.rooms[roomName];
  if (!room) return MAX_LANES;
  let entry = cache.get(roomName);
  if (!entry || Game.time - entry.tick >= REFRESH_TICKS) {
    entry = { tick: Game.time, widths: computeWidths(room) };
    cache.set(roomName, entry);
  }
  return entry.widths[x * 50 + y];
}

export function isChoke(pos: RoomPosition): boolean {
  return laneWidth(pos.roomName, pos.x, pos.y) <= CHOKE_LANES;
}
