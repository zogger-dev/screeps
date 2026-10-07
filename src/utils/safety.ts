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
/**
 * How far ahead work in a keeper's reach may be planned: roughly a creep's trip across the room,
 * so it arrives (and waits at a safe tile, loaded) just as the keeper dies.
 */
export const STAGING_HORIZON = 100;
const KEEPER_OWNER = "Source Keeper";
/** Path cost for unsafe tiles: high enough to route around, but not impassable so creeps can still escape. */
const DANGER_COST = 250;

interface Threat {
  pos: RoomPosition;
  range: number;
  /**
   * Ticks until the threat is gone, if that's known: a Source Keeper dies of old age like any
   * creep (1500 ticks), and its lair then takes 300 ticks to respawn it.
   */
  expiresIn?: number;
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
      .map((c) => ({
        pos: c.pos,
        range: isTrappedKeeper(c) ? TRAPPED_KEEPER_RANGE : DANGER_RANGE,
        expiresIn: c.owner.username === KEEPER_OWNER ? c.ticksToLive : undefined,
      }));
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
 * True if `pos` is safe now, or will be within `horizon` ticks: every threat reaching it is a
 * keeper about to die of old age. Lets work behind a keeper be planned before its window opens.
 */
export function isSafeSoon(pos: RoomPosition, horizon = STAGING_HORIZON): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return true;
  return threats(room)
    .filter((t) => t.pos.inRangeTo(pos, t.range))
    .every((t) => t.expiresIn !== undefined && t.expiresIn <= horizon);
}

/**
 * Harvest spots around a source that no threat reaches: where creeps can actually work it. A
 * source inside a trapped keeper's reach can still have safe spots on its far side.
 */
export function safeHarvestSpots(source: Source): RoomPosition[] {
  const terrain = source.room.getTerrain();
  const spots: RoomPosition[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if ((!dx && !dy) || isWall(terrain, x, y)) continue;
      const pos = new RoomPosition(x, y, source.room.name);
      if (isSafe(pos)) spots.push(pos);
    }
  }
  return spots;
}

/**
 * Sources creeps can work: at least one safe harvest spot. A source guarded by a lair that isn't
 * walled in yet doesn't count even between keeper lives: nothing gets planned or routed there
 * until the danger is contained.
 */
export function safeSources(room: Room): Source[] {
  return room.find(FIND_SOURCES).filter((s) => !isGuardedByOpenLair(s) && safeHarvestSpots(s).length > 0);
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
