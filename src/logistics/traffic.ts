import { moveSafely } from "../utils/safety";
import { harvestSpots } from "../utils/sources";
import { CHOKE_LANES, isChoke, laneWidth } from "./lanes";

/** A drone may set off for a busy source if a spot frees up within this many ticks of its arrival. */
const WAIT_SLACK = 3;
/** A waiting creep stays within this range of its target... */
const PARK_RADIUS = 6;
/** ...unless the nearest tile outside a choke is further out, up to this range. */
const MAX_PARK_RADIUS = 12;

/** Ticks to fill up at a source, from the creep's WORK parts and free capacity. */
function loadTicks(creep: Creep): number {
  return Math.ceil(creep.store.getFreeCapacity(RESOURCE_ENERGY) / (Math.max(1, creep.getActiveBodyparts(WORK)) * HARVEST_POWER));
}

/** Rough ticks for an empty creep to walk `tiles` plain tiles. */
function walkTicks(creep: Creep, tiles: number): number {
  const weight = creep.body.filter((p) => p.hits > 0 && p.type !== MOVE && p.type !== CARRY).length;
  const move = Math.max(1, creep.getActiveBodyparts(MOVE));
  return tiles * Math.max(1, Math.ceil(weight / move));
}

let grantTick = -1;
const grants = new Map<Id<Source>, Set<string>>();

/**
 * Books a source's spots by arrival time. Creeps already next to it keep their spot until they're
 * full (miners and anything else parked there, for good); inbound drones queue in order of arrival
 * and take the first spot to free up. A drone is cleared to approach if its spot will be free
 * within WAIT_SLACK ticks of its arrival; the rest wait at their hold point, so the queue forms in
 * open ground rather than in the choke in front of the source. Recomputed once per tick.
 */
function cleared(source: Source): Set<string> {
  if (grantTick !== Game.time) {
    grants.clear();
    grantTick = Game.time;
  }
  let granted = grants.get(source.id);
  if (granted) return granted;

  granted = new Set<string>();
  const free = new Array<number>(harvestSpots(source)).fill(0);
  const near = source.pos.findInRange(FIND_CREEPS, 1);
  near.forEach((c, i) => {
    if (i >= free.length) return;
    const harvesting = c.my && c.memory.route?.from === source.id && !c.memory.working;
    free[i] = harvesting ? loadTicks(c) : Infinity;
    if (harvesting) granted!.add(c.name);
  });

  const inbound = source.room
    .find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.route?.from === source.id && !c.memory.working && !c.pos.isNearTo(source),
    })
    .map((c) => ({ c, eta: walkTicks(c, c.pos.getRangeTo(source) - 1) }))
    .sort((a, b) => a.eta - b.eta);
  for (const { c, eta } of inbound) {
    const spot = free.indexOf(Math.min(...free));
    const start = Math.max(eta, free[spot]);
    if (start - eta <= WAIT_SLACK) granted.add(c.name);
    free[spot] = start + loadTicks(c);
  }
  grants.set(source.id, granted);
  return granted;
}

/** True if the creep may head for the source now rather than wait at its hold point. */
export function mayApproach(creep: Creep, source: Source): boolean {
  return cleared(source).has(creep.name);
}

/**
 * Waits at a hold point, unless the creep is already past it (closer to the source than the hold
 * point is): then it's inside the choke, and backing out would only block oncoming traffic.
 */
export function holdFor(creep: Creep, target: RoomObject, hold: { x: number; y: number }): boolean {
  const pos = new RoomPosition(hold.x, hold.y, creep.room.name);
  if (creep.pos.getRangeTo(target) < pos.getRangeTo(target)) return false;
  if (!creep.pos.inRangeTo(pos, 1)) moveSafely(creep, pos, { range: 1 });
  return true;
}

/** Nearest tile to `near` that isn't a choke, searching ring by ring out to MAX_PARK_RADIUS. */
function parkingTile(near: RoomPosition): RoomPosition | null {
  for (let r = 1; r <= MAX_PARK_RADIUS; r++) {
    for (let x = near.x - r; x <= near.x + r; x++) {
      for (let y = near.y - r; y <= near.y + r; y++) {
        if (Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) !== r) continue;
        if (x < 1 || x > 48 || y < 1 || y > 48 || laneWidth(near.roomName, x, y) <= CHOKE_LANES) continue;
        return new RoomPosition(x, y, near.roomName);
      }
    }
  }
  return null;
}

/**
 * Waits near `near` without blocking anyone: stays put in open ground within PARK_RADIUS, but
 * otherwise (in a choke, i.e. any tile CHOKE_LANES wide or less, or too far) goes to the open
 * tile nearest `near`.
 */
export function park(creep: Creep, near: RoomPosition): void {
  if (!isChoke(creep.pos) && creep.pos.inRangeTo(near, PARK_RADIUS)) return;
  const tile = parkingTile(near);
  if (tile && !creep.pos.isEqualTo(tile)) moveSafely(creep, tile, { range: 0 });
}
