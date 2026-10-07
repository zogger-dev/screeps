import { isWall } from "../utils/terrain";

/** Tiles as indices 0..2499, x * 50 + y. */
export const tile = (x: number, y: number) => x * 50 + y;
export const edgeDistance = (x: number, y: number) => Math.min(x, y, 49 - x, 49 - y);

/** Walkable 8-neighbours of a tile. */
export function neighbours(terrain: RoomTerrain, t: number): number[] {
  const x = Math.floor(t / 50);
  const y = t % 50;
  const result: number[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && !isWall(terrain, nx, ny)) result.push(tile(nx, ny));
    }
  }
  return result;
}

/** Walking distance (8-way steps over walkable tiles) from `from` to every tile; 255 if unreachable. */
export function walkDistances(terrain: RoomTerrain, from: number[]): Uint8Array {
  const dist = new Uint8Array(2500).fill(255);
  const queue = [...from];
  for (const t of from) dist[t] = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const n of neighbours(terrain, queue[i])) {
      if (dist[n] !== 255) continue;
      dist[n] = dist[queue[i]] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Openness: Chebyshev distance from each walkable tile to the nearest rock or the room's edge. */
export function openness(terrain: RoomTerrain): Uint8Array {
  const dist = new Uint8Array(2500).fill(255);
  const queue: number[] = [];
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (isWall(terrain, x, y) || edgeDistance(x, y) === 0) {
        dist[tile(x, y)] = 0;
        queue.push(tile(x, y));
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const x = Math.floor(queue[i] / 50);
    const y = queue[i] % 50;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || dist[tile(nx, ny)] !== 255) continue;
        dist[tile(nx, ny)] = dist[queue[i]] + 1;
        queue.push(tile(nx, ny));
      }
    }
  }
  return dist;
}

/** Walkable tiles reachable from `seeds` without crossing the ring: where attackers can stand. */
export function outsideRegion(terrain: RoomTerrain, ring: Set<number>, seeds: number[]): Uint8Array {
  const outside = new Uint8Array(2500);
  const queue: number[] = [];
  for (const t of seeds) {
    outside[t] = 1;
    queue.push(t);
  }
  for (let i = 0; i < queue.length; i++) {
    const x = Math.floor(queue[i] / 50);
    const y = queue[i] % 50;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        const n = tile(nx, ny);
        if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || outside[n] || ring.has(n) || isWall(terrain, nx, ny)) continue;
        outside[n] = 1;
        queue.push(n);
      }
    }
  }
  return outside;
}

/** Chebyshev distance from every tile to the nearest tile attackers can stand on (attacks ignore walls). */
export function reachFrom(outside: Uint8Array): Uint8Array {
  const reach = new Uint8Array(2500).fill(255);
  const queue: number[] = [];
  for (let t = 0; t < 2500; t++) {
    if (outside[t]) {
      reach[t] = 0;
      queue.push(t);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const x = Math.floor(queue[i] / 50);
    const y = queue[i] % 50;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || reach[tile(nx, ny)] !== 255) continue;
        reach[tile(nx, ny)] = reach[queue[i]] + 1;
        queue.push(tile(nx, ny));
      }
    }
  }
  return reach;
}
