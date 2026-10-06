/** Anything within this range of a threat is considered unsafe. */
const DANGER_RANGE = 5;
/** Path cost for unsafe tiles: high enough to route around, but not impassable so creeps can still escape. */
const DANGER_COST = 250;

let cacheTick = -1;
const threatCache = new Map<string, RoomPosition[]>();

/** Positions of armed hostile creeps and keeper lairs (keepers respawn there). Cached per tick. */
function threats(room: Room): RoomPosition[] {
  if (cacheTick !== Game.time) {
    threatCache.clear();
    cacheTick = Game.time;
  }
  let result = threatCache.get(room.name);
  if (!result) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0,
    });
    const lairs = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_KEEPER_LAIR,
    });
    result = [...hostiles, ...lairs].map((o) => o.pos);
    threatCache.set(room.name, result);
  }
  return result;
}

export function isSafe(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return true;
  return !threats(room).some((t) => t.inRangeTo(pos, DANGER_RANGE));
}

export function safeSources(room: Room): Source[] {
  return room.find(FIND_SOURCES).filter((s) => isSafe(s.pos));
}

/** Adds danger-zone costs to a cost matrix. Usable as a moveTo costCallback. */
export function avoidThreats(roomName: string, matrix: CostMatrix): void {
  const room = Game.rooms[roomName];
  if (!room) return;
  const terrain = room.getTerrain();
  for (const t of threats(room)) {
    for (let x = Math.max(0, t.x - DANGER_RANGE); x <= Math.min(49, t.x + DANGER_RANGE); x++) {
      for (let y = Math.max(0, t.y - DANGER_RANGE); y <= Math.min(49, t.y + DANGER_RANGE); y++) {
        // A non-zero matrix value overrides terrain, so never touch walls or we'd make them walkable.
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        matrix.set(x, y, Math.max(matrix.get(x, y), DANGER_COST));
      }
    }
  }
}

/** creep.moveTo that paths around dangerous areas. */
export function moveSafely(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  opts: MoveToOpts = {},
): ScreepsReturnCode {
  return creep.moveTo(target, { ...opts, costCallback: avoidThreats });
}
