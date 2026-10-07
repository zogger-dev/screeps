import { isWall } from "../utils/terrain";
import { edgeDistance, openness, outsideRegion, reachFrom, tile, walkDistances } from "./grid";
import { FlowGraph, INFINITE } from "./mincut";

/** Tiles within this many steps of the anchor must be inside the pocket: room for the core. */
const SEED_RADIUS = 5;
/** Tiles this many steps away or more are outside, so the inner ring falls in between. */
const POCKET_RADIUS = 13;
/** Candidate anchors need at least this much open ground around them (distance to rock). */
const MIN_OPENNESS = 3;
/**
 * Candidate anchors are at least this many steps apart on foot, so they describe different
 * pockets. Walking distance, not straight-line: two spots either side of a ridge are far apart.
 */
const ANCHOR_SPACING = 8;
/** Enough to cover every distinct area of a room; each one costs a min-cut. */
const MAX_CANDIDATES = 40;
/** Safe tiles a pocket needs for the core: storage, terminal, spawns, towers, factory and roads. */
const CORE_AREA = 45;
/** Out of attackers' ranged reach from outside the ring. */
const ATTACK_REACH = 3;
/** Cost of each inner-ring tile (to build and keep repaired), against walking distance. */
const RING_WEIGHT = 10;

export interface CoreCandidate {
  anchor: { x: number; y: number };
  /** Inner-ring tiles sealing the pocket. */
  ring: [number, number][];
  /** Walkable tiles inside the ring. */
  area: number;
  /** Inside tiles out of ranged reach from outside, clear of harvest and upgrade spots. */
  safeArea: number;
  /** Walking distance from the anchor to each source and the controller, summed. */
  logistics: number;
  feasible: boolean;
  /** Lower is better: ring tiles x RING_WEIGHT + logistics. */
  cost: number;
}

/**
 * Centres of open ground to try, most open first, each at least ANCHOR_SPACING steps on foot from
 * the others, so every distinct area (open field or pocket behind a ridge) gets one.
 */
function anchors(terrain: RoomTerrain): number[] {
  const open = openness(terrain);
  const tiles: number[] = [];
  for (let t = 0; t < 2500; t++) {
    const x = Math.floor(t / 50);
    const y = t % 50;
    if (open[t] >= MIN_OPENNESS && open[t] !== 255 && edgeDistance(x, y) >= 6) tiles.push(t);
  }
  tiles.sort((a, b) => open[b] - open[a]);
  const chosen: number[] = [];
  const claimed = new Uint8Array(2500);
  for (const t of tiles) {
    if (claimed[t]) continue;
    chosen.push(t);
    const walk = walkDistances(terrain, [t]);
    for (let u = 0; u < 2500; u++) if (walk[u] < ANCHOR_SPACING) claimed[u] = 1;
    if (chosen.length >= MAX_CANDIDATES) break;
  }
  return chosen;
}

/**
 * The pocket around an anchor: min-cut between its seed (tiles within SEED_RADIUS steps) and
 * everything POCKET_RADIUS or more steps away, so the cut lands on the narrowest entrances in
 * between. Returns the cut tiles, or null if the seed can't be sealed off.
 */
function pocketCut(terrain: RoomTerrain, walk: Uint8Array): number[] | null {
  const S = 5000;
  const T = 5001;
  const graph = new FlowGraph(5002);
  for (let t = 0; t < 2500; t++) {
    const x = Math.floor(t / 50);
    const y = t % 50;
    if (isWall(terrain, x, y) || walk[t] === 255) continue;
    const seed = walk[t] <= SEED_RADIUS;
    const far = walk[t] >= POCKET_RADIUS || edgeDistance(x, y) === 0;
    const cuttable = !seed && !far && edgeDistance(x, y) > 1;
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
    if (far) graph.addEdge(S, t * 2, INFINITE);
    if (seed) graph.addEdge(t * 2 + 1, T, INFINITE);
  }
  if (graph.maxFlow(S, T) >= INFINITE) return null;
  const side = graph.reachable(S);
  const cut: number[] = [];
  for (let t = 0; t < 2500; t++) if (side[t * 2] && !side[t * 2 + 1]) cut.push(t);
  return cut;
}

/** Steps from the anchor to the nearest tile next to `pos` (sources and the controller are solid). */
function stepsTo(walk: Uint8Array, pos: RoomPosition): number {
  let best = 255;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x >= 0 && x < 50 && y >= 0 && y < 50) best = Math.min(best, walk[tile(x, y)]);
    }
  }
  return best;
}

function evaluate(room: Room, terrain: RoomTerrain, anchor: number, reserved: Set<number>): CoreCandidate | null {
  const walk = walkDistances(terrain, [anchor]);
  const cut = pocketCut(terrain, walk);
  if (!cut) return null;
  const ring = new Set(cut);
  const seeds: number[] = [];
  for (let t = 0; t < 2500; t++) {
    const x = Math.floor(t / 50);
    if (walk[t] !== 255 && (walk[t] >= POCKET_RADIUS || edgeDistance(x, t % 50) === 0)) seeds.push(t);
  }
  const outside = outsideRegion(terrain, ring, seeds);
  const reach = reachFrom(outside);

  let area = 0;
  let safeArea = 0;
  for (let t = 0; t < 2500; t++) {
    if (walk[t] === 255 || outside[t] || ring.has(t)) continue;
    area++;
    if (reach[t] > ATTACK_REACH && !reserved.has(t)) safeArea++;
  }
  const targets = [...room.find(FIND_SOURCES).map((s) => s.pos)];
  if (room.controller) targets.push(room.controller.pos);
  const logistics = targets.reduce((sum, p) => sum + stepsTo(walk, p), 0);
  const feasible = safeArea >= CORE_AREA;
  return {
    anchor: { x: Math.floor(anchor / 50), y: anchor % 50 },
    ring: cut.map((t) => [Math.floor(t / 50), t % 50]),
    area,
    safeArea,
    logistics,
    feasible,
    cost: cut.length * RING_WEIGHT + logistics,
  };
}

/** Harvest and upgrade spots: next to sources, minerals and the controller. */
function reservedSpots(room: Room): Set<number> {
  const reserved = new Set<number>();
  const keep: RoomPosition[] = [...room.find(FIND_SOURCES).map((s) => s.pos), ...room.find(FIND_MINERALS).map((m) => m.pos)];
  if (room.controller) keep.push(room.controller.pos);
  for (const p of keep) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) reserved.add(tile(p.x + dx, p.y + dy));
  }
  return reserved;
}

/** The pocket around a given tile (e.g. the spawn's), scored like a core candidate; null if it can't be sealed. */
export function pocketAround(room: Room, x: number, y: number): CoreCandidate | null {
  return evaluate(room, room.getTerrain(), tile(x, y), reservedSpots(room));
}

/**
 * Candidate pockets for the room's core, best first: those with room for the core (CORE_AREA safe
 * tiles) by cost (short inner ring, short walks to sources and controller), then the rest.
 */
export function coreCandidates(room: Room): CoreCandidate[] {
  const terrain = room.getTerrain();
  const reserved = reservedSpots(room);
  return anchors(terrain)
    .map((a) => evaluate(room, terrain, a, reserved))
    .filter((c): c is CoreCandidate => c !== null)
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.cost - b.cost);
}
