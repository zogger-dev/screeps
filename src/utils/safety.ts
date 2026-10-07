import { isEnclosed, isGuardedByOpenLair, isTrappedKeeper, keeperLairs } from "./lairs";
import { isWall } from "./terrain";

/** Anything within this range of a roaming threat is considered unsafe. */
const DANGER_RANGE = 5;
/** A keeper trapped on its lair can't move, so only its ranged attack reaches out. */
const TRAPPED_KEEPER_RANGE = 3;
/**
 * An open lair becomes dangerous this many ticks before its keeper respawns, leaving creeps time
 * to walk clear. Before that, with the keeper dead, its area is safe to work in.
 */
const LAIR_WARNING_TICKS = 50;
/** Path cost for unsafe tiles: high enough to route around, but not impassable so creeps can still escape. */
const DANGER_COST = 250;

interface Threat {
  pos: RoomPosition;
  range: number;
}

let cacheTick = -1;
const threatCache = new Map<string, Threat[]>();

/**
 * Armed hostile creeps, plus keeper lairs. A live keeper is covered as a hostile creep; a lair
 * adds danger only when an open one is about to respawn its keeper, or permanently around an
 * enclosed one (whose keeper, present or next, can only reach its ranged-attack range).
 * Cached per tick.
 */
function threats(room: Room): Threat[] {
  if (cacheTick !== Game.time) {
    threatCache.clear();
    cacheTick = Game.time;
  }
  let result = threatCache.get(room.name);
  if (!result) {
    result = room
      .find(FIND_HOSTILE_CREEPS, {
        filter: (c) => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0,
      })
      .map((c) => ({ pos: c.pos, range: isTrappedKeeper(c) ? TRAPPED_KEEPER_RANGE : DANGER_RANGE }));
    for (const lair of keeperLairs(room)) {
      if (isEnclosed(lair)) {
        result.push({ pos: lair.pos, range: TRAPPED_KEEPER_RANGE });
      } else if (lair.ticksToSpawn !== undefined && lair.ticksToSpawn <= LAIR_WARNING_TICKS) {
        result.push({ pos: lair.pos, range: DANGER_RANGE });
      }
    }
    threatCache.set(room.name, result);
  }
  return result;
}

/** True if no threat reaches `pos`, with `margin` extra tiles of clearance. */
export function isSafe(pos: RoomPosition, margin = 0): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return true;
  return !threats(room).some((t) => t.pos.inRangeTo(pos, t.range + margin));
}

/**
 * Sources creeps can work: safe with one tile of margin, since harvesters stand next to the
 * source. A source guarded by a lair that isn't walled in yet doesn't count even between keeper
 * lives: nothing gets planned or routed there until the danger is contained.
 */
export function safeSources(room: Room): Source[] {
  return room.find(FIND_SOURCES).filter((s) => isSafe(s.pos, 1) && !isGuardedByOpenLair(s));
}

/** Adds danger-zone costs to a cost matrix. Usable as a moveTo costCallback. */
export function avoidThreats(roomName: string, matrix: CostMatrix): void {
  const room = Game.rooms[roomName];
  if (!room) return;
  const terrain = room.getTerrain();
  for (const { pos: t, range } of threats(room)) {
    for (let x = Math.max(0, t.x - range); x <= Math.min(49, t.x + range); x++) {
      for (let y = Math.max(0, t.y - range); y <= Math.min(49, t.y + range); y++) {
        // A non-zero matrix value overrides terrain, so never touch walls or we'd make them walkable.
        if (isWall(terrain, x, y)) continue;
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
