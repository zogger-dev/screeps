import { isWall } from "../utils/terrain";
import { edgeDistance, outsideRegion, reachFrom, tile } from "./grid";
import { FlowGraph, INFINITE } from "./mincut";
import { ATTACK_REACH, CORE_RCL, exposureMap, optimizeTowers, targetGroups, type TargetGroup, type TowerSpot } from "./towers";

/** Tiles this close to the room edge can't hold walls (nothing is buildable next to an exit). */
const NO_BUILD_BAND = 1;
/**
 * Tiles at least this far in from the edge must end up inside the ring, so the cut has to fall
 * within the band between: walls at the exits, keeping nearly the whole room ours.
 */
const PROTECTED_DEPTH = 6;
/** Sources, the controller, minerals and spawns are protected out to this range wherever they are. */
const KEY_OBJECT_RANGE = 2;

export interface DefensePlan {
  /** Tiles to wall off (ramparts where our creeps need to pass). */
  ring: [number, number][];
  /** Tower spots in build order, with the level each is built at. */
  towers: TowerSpot[];
  /** What the towers cover (spawn pocket, controller, core entrances, outer ring), for drawing. */
  groups: TargetGroup[];
  inside: number;
  outside: number;
  /** The core pocket taken into account, if one had been chosen. */
  core?: { x: number; y: number };
  computedAt: number;
}

/** A core pocket: its centre and the inner-ring tiles sealing it (see defense/core.ts). */
export interface CorePocket {
  anchor: { x: number; y: number };
  ring: [number, number][];
}

/** Walkable tiles on the room edge: where attackers enter. */
function exitTiles(terrain: RoomTerrain): number[] {
  const exits: number[] = [];
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) if (edgeDistance(x, y) === 0 && !isWall(terrain, x, y)) exits.push(tile(x, y));
  }
  return exits;
}

/**
 * Minimum set of tiles separating the exits from the protected area: max-flow on the tile graph,
 * each tile split into in/out nodes joined by its capacity (1 if it can hold a wall, infinite if
 * not), neighbours joined both ways at infinite capacity. The cut tiles are those whose in-node the
 * source side reaches but whose out-node it doesn't.
 */
function minCut(terrain: RoomTerrain, isProtected: (x: number, y: number) => boolean): number[] | null {
  const S = 5000;
  const T = 5001;
  const graph = new FlowGraph(5002);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (isWall(terrain, x, y)) continue;
      const t = tile(x, y);
      const cuttable = edgeDistance(x, y) > NO_BUILD_BAND && !isProtected(x, y);
      graph.addEdge(t * 2, t * 2 + 1, cuttable ? 1 : INFINITE);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && !isWall(terrain, nx, ny)) {
            graph.addEdge(t * 2 + 1, tile(nx, ny) * 2, INFINITE);
          }
        }
      }
      if (edgeDistance(x, y) === 0) graph.addEdge(S, t * 2, INFINITE);
      if (isProtected(x, y)) graph.addEdge(t * 2 + 1, T, INFINITE);
    }
  }
  if (graph.maxFlow(S, T) >= INFINITE) return null;
  const side = graph.reachable(S);
  const cut: number[] = [];
  for (let t = 0; t < 2500; t++) if (side[t * 2] && !side[t * 2 + 1]) cut.push(t);
  return cut;
}

/**
 * Plans the room's defenses on its terrain: an outer ring of walls at the exits (the minimum cut
 * between exits and everything at least PROTECTED_DEPTH in, plus key objects), and tower spots
 * anywhere inside it out of reach from outside, placed stage by stage to cover the spawn pocket,
 * the controller and (once it has advanced tech) the core's entrances at full strength, preferring
 * nooks in the rock (see defense/towers.ts). Returns null if the exits can't be sealed (a key
 * object too close to an exit).
 */
export function planDefense(room: Room, core?: CorePocket): DefensePlan | null {
  const terrain = room.getTerrain();
  const keyObjects: RoomPosition[] = [
    ...room.find(FIND_SOURCES).map((s) => s.pos),
    ...room.find(FIND_MINERALS).map((m) => m.pos),
    ...room.find(FIND_MY_SPAWNS).map((s) => s.pos),
  ];
  if (room.controller) keyObjects.push(room.controller.pos);
  const isProtected = (x: number, y: number) =>
    edgeDistance(x, y) >= PROTECTED_DEPTH ||
    keyObjects.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= KEY_OBJECT_RANGE);

  const cut = minCut(terrain, isProtected);
  if (!cut) return null;
  const ring = new Set(cut);
  const outside = outsideRegion(terrain, ring, exitTiles(terrain));
  const reach = reachFrom(outside);

  const reserved = new Set<number>();
  for (const p of keyObjects) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) reserved.add(tile(p.x + dx, p.y + dy));
  }
  const occupied = new Set(
    room
      .find(FIND_STRUCTURES)
      .filter((s) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_TOWER)
      .map((s) => tile(s.pos.x, s.pos.y)),
  );

  let inside = 0;
  for (let t = 0; t < 2500; t++) {
    if (!isWall(terrain, Math.floor(t / 50), t % 50) && !outside[t] && !ring.has(t)) inside++;
  }

  const candidates: [number, number][] = [];
  for (let t = 0; t < 2500; t++) {
    const x = Math.floor(t / 50);
    const y = t % 50;
    if (isWall(terrain, x, y) || outside[t] || ring.has(t) || reach[t] <= ATTACK_REACH) continue;
    if (!reserved.has(t) && !occupied.has(t)) candidates.push([x, y]);
  }
  const ringTiles = cut.map((t): [number, number] => [Math.floor(t / 50), t % 50]);
  const groups = targetGroups(room, ringTiles, core);
  const open = exposureMap(room);
  const sheltered = core ? exposureMap(room, core) : open;
  const exposureAt = (rcl: number) => (rcl >= CORE_RCL ? sheltered : open);
  const towers = optimizeTowers(candidates, groups, exposureAt, CONTROLLER_STRUCTURES[STRUCTURE_TOWER][8]);

  return {
    ring: ringTiles,
    towers,
    groups,
    inside,
    outside: outside.reduce((a: number, b) => a + b, 0),
    core: core?.anchor,
    computedAt: Game.time,
  };
}
