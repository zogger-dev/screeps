import { avoidThreats } from "./safety";

/** Legs between fixed points don't change often; recompute them this often to pick up new roads. */
const LEG_CACHE_TICKS = 500;

let matrixTick = -1;
const matrices = new Map<string, CostMatrix>();

/**
 * Movement costs as moveTo sees them: roads 1 (terrain defaults give plain 2, swamp 10),
 * obstacle structures impassable, danger zones expensive. Cached per tick.
 */
function roomCosts(roomName: string): CostMatrix | false {
  const room = Game.rooms[roomName];
  if (!room) return false;
  if (matrixTick !== Game.time) {
    matrices.clear();
    matrixTick = Game.time;
  }
  let costs = matrices.get(roomName);
  if (!costs) {
    costs = new PathFinder.CostMatrix();
    for (const s of room.find(FIND_STRUCTURES)) {
      if (s.structureType === STRUCTURE_ROAD) costs.set(s.pos.x, s.pos.y, 1);
      else if ((OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType)) costs.set(s.pos.x, s.pos.y, 0xff);
    }
    avoidThreats(roomName, costs);
    matrices.set(roomName, costs);
  }
  return costs;
}

/** Cost of walking from `from` to within `range` of `to`, roughly in ticks for a half-speed creep. */
export function travelCost(from: RoomPosition, to: RoomPosition, range = 1): number {
  const result = PathFinder.search(
    from,
    { pos: to, range },
    { plainCost: 2, swampCost: 10, maxRooms: 1, roomCallback: roomCosts },
  );
  return result.incomplete ? Infinity : result.cost;
}

/** A tile on a leg, with its fatigue factor: road 0.5, plain 1, swamp 5. */
export interface LegTile {
  x: number;
  y: number;
  factor: number;
}

/** A cached path between two fixed points: its path cost and the tiles walked, in order. */
export interface Leg {
  cost: number;
  tiles: LegTile[];
}

let legTick = -1;
const legs = new Map<string, Leg>();

/** Fatigue factor of each tile: roads halve fatigue, swamps multiply it by 5. */
function tileFactors(roomName: string, path: RoomPosition[]): LegTile[] {
  const room = Game.rooms[roomName];
  const terrain = room?.getTerrain();
  return path.map(({ x, y }) => {
    const road = room?.lookForAt(LOOK_STRUCTURES, x, y).some((s) => s.structureType === STRUCTURE_ROAD);
    const swamp = terrain !== undefined && (terrain.get(x, y) & TERRAIN_MASK_SWAMP) !== 0;
    return { x, y, factor: road ? 0.5 : swamp ? 5 : 1 };
  });
}

/**
 * The path between two fixed points (e.g. a source and the controller), cached for a while so new
 * roads get picked up. Walking from `from` to within `range` of `to`; `from` itself isn't included.
 */
export function cachedLeg(from: RoomPosition, to: RoomPosition, range = 1): Leg {
  if (Game.time - legTick >= LEG_CACHE_TICKS) {
    legs.clear();
    legTick = Game.time;
  }
  const key = `${from.roomName}:${from.x},${from.y}>${to.x},${to.y}:${range}`;
  let leg = legs.get(key);
  if (!leg) {
    const result = PathFinder.search(
      from,
      { pos: to, range },
      { plainCost: 2, swampCost: 10, maxRooms: 1, roomCallback: roomCosts },
    );
    leg = result.incomplete
      ? { cost: Infinity, tiles: [] }
      : { cost: result.cost, tiles: tileFactors(from.roomName, result.path) };
    legs.set(key, leg);
  }
  return leg;
}

/** travelCost between two fixed points, cached for a while. */
export function cachedTravelCost(from: RoomPosition, to: RoomPosition, range = 1): number {
  return cachedLeg(from, to, range).cost;
}
