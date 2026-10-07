import { avoidThreats } from "./safety";

/** Source -> destination legs don't change often; recompute them this often to pick up new roads. */
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

let legTick = -1;
const legs = new Map<string, number>();

/** travelCost between two fixed points (e.g. a source and the controller), cached for a while. */
export function cachedTravelCost(from: RoomPosition, to: RoomPosition, range = 1): number {
  if (Game.time - legTick >= LEG_CACHE_TICKS) {
    legs.clear();
    legTick = Game.time;
  }
  const key = `${from.roomName}:${from.x},${from.y}>${to.x},${to.y}:${range}`;
  let cost = legs.get(key);
  if (cost === undefined) {
    cost = travelCost(from, to, range);
    legs.set(key, cost);
  }
  return cost;
}
