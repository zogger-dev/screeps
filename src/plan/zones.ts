import { edgeDistance, neighbours, openness, tile, walkDistances } from "../defense/grid";
import { FlowGraph, INFINITE } from "../defense/mincut";
import { isWall } from "../utils/terrain";

/** Over-segmentation: neighbouring regions merge during the watershed only across flat plateaus. */
const MIN_PERSISTENCE = 1;
/** Regions smaller than this many tiles are always folded into a neighbour. */
const MIN_AREA = 30;
/** Zones don't grow beyond this many tiles by merging: about what a player would plan as one area. */
const MAX_AREA = 350;
/**
 * Two regions merge if their shared border is at least this share of the smaller one's open
 * perimeter: a long shared border means they aren't really separate.
 */
const MIN_AFFINITY = 0.25;
/** When splitting a region, each half is seeded with the tiles within this share of the distance across. */
const SPLIT_SEED_SHARE = 0.3;
/** A line this many tiles wide or less is a choke: a natural zone boundary. */
const CHOKE_WIDTH = 4;
/** A choke only splits a zone if both sides keep at least this many tiles. */
const MIN_PART = 40;
/**
 * Zones are developed in value order until they add up to this many tiles: room for a full base
 * (about 85 structures and 60 extensions at RCL 8, plus roads), with the rest left open.
 */
const DEVELOPED_AREA = 1100;
/** Value of each tile of usable space, up to SPACE_CAP. */
const SPACE_CAP = 120;

export interface Zone {
  id: number;
  /** Most open tile: the zone's centre. */
  peak: { x: number; y: number };
  area: number;
  /** Zone tiles bordering another zone or a room exit: what has to be held. */
  perimeter: number;
  /** Area per perimeter tile: higher is easier to defend. */
  defensibility: number;
  sources: number;
  controller: boolean;
  /** Holds the spawn (or, in a room not yet settled, the controller): where development starts. */
  spawn: boolean;
  /** Steps from the spawn (or, unsettled, the controller) to the zone's peak. */
  distance: number;
  /** Development order (1 = first); 0 if it's left open (not needed for the base). */
  order: number;
  score: number;
}

export interface Partition {
  zones: Zone[];
  /** Zone index per tile (x * 50 + y), as a string; "." for rock. One char per tile: "A" + index. */
  labels: string;
  computedAt: number;
}

/** Union-find over region ids, keeping each set's peak openness. */
class Regions {
  parent: number[] = [];
  peak: number[] = [];

  add(height: number): number {
    this.parent.push(this.parent.length);
    this.peak.push(height);
    return this.parent.length - 1;
  }

  find(r: number): number {
    while (this.parent[r] !== r) r = this.parent[r] = this.parent[this.parent[r]];
    return r;
  }

  union(a: number, b: number): number {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return a;
    const [keep, drop] = this.peak[a] >= this.peak[b] ? [a, b] : [b, a];
    this.parent[drop] = keep;
    return keep;
  }
}

/**
 * Over-segmentation by watershed on openness: tiles are flooded from the most open down, so each
 * open area grows into a region and regions meet at the narrowest passages between them. Regions
 * only merge here across flat plateaus (neck within MIN_PERSISTENCE of the smaller peak).
 */
function watershed(terrain: RoomTerrain, open: Uint8Array): Int16Array {
  const order: number[] = [];
  for (let t = 0; t < 2500; t++) if (!isWall(terrain, Math.floor(t / 50), t % 50)) order.push(t);
  order.sort((a, b) => open[b] - open[a]);
  const regions = new Regions();
  const label = new Int16Array(2500).fill(-1);
  for (const t of order) {
    const x = Math.floor(t / 50);
    const y = t % 50;
    const around = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && label[tile(nx, ny)] >= 0) {
          around.add(regions.find(label[tile(nx, ny)]));
        }
      }
    }
    if (around.size === 0) {
      label[t] = regions.add(open[t]);
      continue;
    }
    const sorted = [...around].sort((a, b) => regions.peak[b] - regions.peak[a]);
    let joined = sorted[0];
    for (const other of sorted.slice(1)) {
      const smaller = Math.min(regions.peak[regions.find(joined)], regions.peak[regions.find(other)]);
      if (smaller - open[t] < MIN_PERSISTENCE) joined = regions.union(joined, other);
    }
    label[t] = regions.find(joined);
  }
  for (let t = 0; t < 2500; t++) if (label[t] >= 0) label[t] = regions.find(label[t]);
  return label;
}

/** Per region: tile count, open perimeter (tiles bordering another region or an exit), and shared borders. */
function regionStats(label: Int16Array): { area: Map<number, number>; perimeter: Map<number, number>; border: Map<string, number> } {
  const area = new Map<number, number>();
  const perimeter = new Map<number, number>();
  const border = new Map<string, number>();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const r = label[tile(x, y)];
      if (r < 0) continue;
      area.set(r, (area.get(r) ?? 0) + 1);
      const touching = new Set<number>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
          const o = label[tile(nx, ny)];
          if (o >= 0 && o !== r) touching.add(o);
        }
      }
      if (touching.size > 0 || edgeDistance(x, y) === 0) perimeter.set(r, (perimeter.get(r) ?? 0) + 1);
      for (const o of touching) {
        const key = r < o ? `${r},${o}` : `${o},${r}`;
        border.set(key, (border.get(key) ?? 0) + 1);
      }
    }
  }
  return { area, perimeter, border };
}

/** Walking distances from `from`, staying inside region `r`. */
function walkWithin(terrain: RoomTerrain, label: Int16Array, r: number, from: number): Uint8Array {
  const dist = new Uint8Array(2500).fill(255);
  dist[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const n of neighbours(terrain, queue[i])) {
      if (label[n] !== r || dist[n] !== 255) continue;
      dist[n] = dist[queue[i]] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Min-cut on the tiles in `tiles` between seed sets A and B: its size, and the tiles left on A's side. */
function cutBetween(terrain: RoomTerrain, tiles: Set<number>, seedA: Set<number>, seedB: Set<number>): { size: number; sideA: Set<number> } | null {
  const S = 5000;
  const T = 5001;
  const graph = new FlowGraph(5002);
  for (const t of tiles) {
    const seeded = seedA.has(t) || seedB.has(t);
    graph.addEdge(t * 2, t * 2 + 1, seeded ? INFINITE : 1);
    for (const n of neighbours(terrain, t)) if (tiles.has(n)) graph.addEdge(t * 2 + 1, n * 2, INFINITE);
    if (seedA.has(t)) graph.addEdge(S, t * 2, INFINITE);
    if (seedB.has(t)) graph.addEdge(t * 2 + 1, T, INFINITE);
  }
  const size = graph.maxFlow(S, T);
  if (size >= INFINITE) return null;
  const side = graph.reachable(S);
  return { size, sideA: new Set([...tiles].filter((t) => side[t * 2] && side[t * 2 + 1])) };
}

/**
 * The narrowest line across region `r`: a min-cut between its two ends, the tiles furthest apart on
 * foot (plus everything within SPLIT_SEED_SHARE of that distance from each). Returns its width and
 * the tiles on the far side, or null if the region is too small to have two ends.
 */
function narrowestCut(terrain: RoomTerrain, label: Int16Array, r: number): { size: number; far: number[]; near: number } | null {
  const tiles: number[] = [];
  for (let t = 0; t < 2500; t++) if (label[t] === r) tiles.push(t);
  const farthest = (dist: Uint8Array) => tiles.reduce((best, t) => (dist[t] !== 255 && dist[t] > dist[best] ? t : best), tiles[0]);
  const a = farthest(walkWithin(terrain, label, r, tiles[0]));
  const fromA = walkWithin(terrain, label, r, a);
  const b = farthest(fromA);
  const fromB = walkWithin(terrain, label, r, b);
  const across = fromA[b];
  if (across === 255 || across < 4) return null;
  const seedA = new Set(tiles.filter((t) => fromA[t] <= across * SPLIT_SEED_SHARE));
  const seedB = new Set(tiles.filter((t) => fromB[t] <= across * SPLIT_SEED_SHARE));
  const cut = cutBetween(terrain, new Set(tiles), seedA, seedB);
  if (!cut) return null;
  const far = tiles.filter((t) => !cut.sideA.has(t));
  return { size: cut.size, far, near: tiles.length - far.length };
}

/**
 * Width of the narrowest line between two neighbouring regions: a min-cut between their interiors
 * (tiles more than 2 from the other region). Infinite if either has no interior (it's all border).
 */
function neckWidth(terrain: RoomTerrain, label: Int16Array, a: number, b: number): number {
  const near = (t: number, other: number) => {
    const x = Math.floor(t / 50);
    const y = t % 50;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && label[tile(nx, ny)] === other) return true;
    }
    return false;
  };
  const tiles = new Set<number>();
  const seedA = new Set<number>();
  const seedB = new Set<number>();
  for (let t = 0; t < 2500; t++) {
    if (label[t] === a) {
      tiles.add(t);
      if (!near(t, b)) seedA.add(t);
    } else if (label[t] === b) {
      tiles.add(t);
      if (!near(t, a)) seedB.add(t);
    }
  }
  if (seedA.size === 0 || seedB.size === 0) return Infinity;
  return cutBetween(terrain, tiles, seedA, seedB)?.size ?? Infinity;
}

/**
 * Size-aware partition: over-segment with a watershed and split regions over MAX_AREA along their
 * shortest dividing lines (min-cut). Then repeatedly merge the adjacent pair whose shared border is
 * longest relative to the smaller one's open perimeter, as long as the result stays within
 * MAX_AREA, the border is at least MIN_AFFINITY of that perimeter, and no choke (a neck of
 * CHOKE_WIDTH tiles or fewer) separates them; regions under MIN_AREA are always folded in. Finally
 * split zones at chokes inside them (keeping MIN_PART tiles each side), so boundaries fall right at
 * narrow entrances rather than down the corridors behind them.
 */
function segment(terrain: RoomTerrain, open: Uint8Array): Int16Array {
  const label = watershed(terrain, open);
  let next = Math.max(...label) + 1;
  const splitWhere = (accept: (cut: { size: number; far: number[]; near: number }, area: number) => boolean) => {
    for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
      changed = false;
      const { area } = regionStats(label);
      for (const [r, size] of area) {
        const cut = narrowestCut(terrain, label, r);
        if (cut && accept(cut, size)) {
          for (const t of cut.far) label[t] = next;
          next++;
          changed = true;
        }
      }
    }
  };

  // Open fields come out of the watershed as one region; split them along their shortest lines.
  splitWhere((_, area) => area > MAX_AREA);

  // Merge neighbours with long shared borders, unless a choke separates them.
  const necks = new Map<string, number>();
  for (;;) {
    const { area, perimeter, border } = regionStats(label);
    let best: { a: number; b: number; affinity: number } | undefined;
    for (const [key, shared] of border) {
      const [a, b] = key.split(",").map(Number);
      const small = Math.min(area.get(a)!, area.get(b)!) < MIN_AREA;
      if (!small && area.get(a)! + area.get(b)! > MAX_AREA) continue;
      const affinity = shared / Math.min(perimeter.get(a)!, perimeter.get(b)!) + (small ? 10 : 0);
      if (affinity < MIN_AFFINITY) continue;
      if (!small) {
        if (!necks.has(key)) necks.set(key, neckWidth(terrain, label, a, b));
        if (necks.get(key)! <= CHOKE_WIDTH) continue;
      }
      if (!best || affinity > best.affinity) best = { a, b, affinity };
    }
    if (!best) break;
    const { a, b } = best;
    for (let t = 0; t < 2500; t++) if (label[t] === b) label[t] = a;
    for (const key of [...necks.keys()]) if (key.split(",").some((r) => Number(r) === a || Number(r) === b)) necks.delete(key);
  }

  // Split at chokes inside zones (e.g. a pocket's entrance with a corridor beyond), and anything
  // still oversized along its shortest line.
  splitWhere((cut, area) => area > MAX_AREA || (cut.size <= CHOKE_WIDTH && Math.min(cut.near, cut.far.length) >= MIN_PART));
  return label;
}

/**
 * Partitions the room into zones and orders their development: the spawn's zone first, then the
 * rest by value (space, defensibility, sources) against distance from the spawn, until they add up
 * to DEVELOPED_AREA. The rest are left open: roads and containers, nothing valuable.
 */
export function partitionRoom(room: Room): Partition {
  const terrain = room.getTerrain();
  const open = openness(terrain);
  const raw = segment(terrain, open);
  const ids = [...new Set([...raw].filter((r) => r >= 0))];
  const index = new Map(ids.map((r, i) => [r, i]));
  const label = Int16Array.from(raw, (r) => (r >= 0 ? index.get(r)! : -1));

  // Development starts from the spawn, or from the controller in a room we haven't settled yet.
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const origin = spawn?.pos ?? room.controller?.pos;
  const fromSpawn = origin ? walkDistances(terrain, [tile(origin.x, origin.y)]) : new Uint8Array(2500).fill(0);
  const zoneNear = (pos: { x: number; y: number }) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const z = label[tile(pos.x + dx, pos.y + dy)];
        if (z >= 0) return z;
      }
    }
    return -1;
  };

  const zones: Zone[] = ids.map((_, id) => ({
    id, peak: { x: 0, y: 0 }, area: 0, perimeter: 0, defensibility: 0,
    sources: 0, controller: false, spawn: false, distance: 0, order: 0, score: 0,
  }));
  const peakOpen = new Array<number>(zones.length).fill(-1);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const z = label[tile(x, y)];
      if (z < 0) continue;
      const zone = zones[z];
      zone.area++;
      if (open[tile(x, y)] > peakOpen[z]) {
        peakOpen[z] = open[tile(x, y)];
        zone.peak = { x, y };
      }
      let border = edgeDistance(x, y) === 0;
      for (let dx = -1; dx <= 1 && !border; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && label[tile(nx, ny)] >= 0 && label[tile(nx, ny)] !== z) border = true;
        }
      }
      if (border) zone.perimeter++;
    }
  }
  for (const s of room.find(FIND_SOURCES)) if (zoneNear(s.pos) >= 0) zones[zoneNear(s.pos)].sources++;
  if (room.controller && zoneNear(room.controller.pos) >= 0) zones[zoneNear(room.controller.pos)].controller = true;
  if (origin && zoneNear(origin) >= 0) zones[zoneNear(origin)].spawn = true;

  for (const zone of zones) {
    zone.defensibility = zone.area / Math.max(1, zone.perimeter);
    zone.distance = fromSpawn[tile(zone.peak.x, zone.peak.y)];
    // Value: space (capped) scaled by defensibility, plus sources and the controller; minus distance.
    const space = Math.min(zone.area, SPACE_CAP);
    zone.score = Math.round(space * zone.defensibility + 30 * zone.sources + 30 * Number(zone.controller) - zone.distance);
  }
  const ranked = [...zones].sort((a, b) => Number(b.spawn) - Number(a.spawn) || b.score - a.score);
  let developed = 0;
  ranked.forEach((z, i) => {
    if (developed >= DEVELOPED_AREA) return;
    developed += z.area;
    z.order = i + 1;
  });

  let labels = "";
  for (let t = 0; t < 2500; t++) labels += label[t] >= 0 ? String.fromCharCode(65 + label[t]) : ".";
  return { zones, labels, computedAt: Game.time };
}
