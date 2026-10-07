import { setting } from "../utils/settings";
import { isWall } from "../utils/terrain";
import { pocketAround } from "./core";
import { outsideRegion, tile } from "./grid";

/** Towers unlocked at each level that adds one: 1 at RCL 3, 2 at 5, 3 at 7, 6 at 8. */
export const STAGES = [
  { rcl: 3, towers: 1 },
  { rcl: 5, towers: 2 },
  { rcl: 7, towers: 3 },
  { rcl: 8, towers: 6 },
];
/** Attackers shoot from up to 3 tiles away. */
export const ATTACK_REACH = 3;
/** The core matters (and is walled) once its advanced tech arrives: terminal and labs at RCL 6. */
export const CORE_RCL = 6;
/** Groups whose entrances must hold; the outer ring only delays, so it's just a tie-breaker. */
const OUTER = "outer ring";
/** Share of the other pockets' average damage added to the weakest's, so general coverage still counts. */
const OTHERS_WEIGHT = 0.1;
/** Share of the outer ring's average damage added, as a tie-breaker. */
const OUTER_WEIGHT = 0.05;

/** Points that need covering, from the level what they protect exists. */
export interface TargetGroup {
  name: string;
  points: [number, number][];
  fromRcl: number;
  /** From Memory.defenseTargets rather than built in. */
  custom?: boolean;
}

export interface TowerSpot {
  x: number;
  y: number;
  /** Level it's built at. */
  rcl: number;
}

export const range = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** Tower damage at range r: full within TOWER_OPTIMAL_RANGE, falling linearly to its floor at TOWER_FALLOFF_RANGE. */
export function towerDamage(r: number): number {
  if (r <= TOWER_OPTIMAL_RANGE) return TOWER_POWER_ATTACK;
  if (r >= TOWER_FALLOFF_RANGE) return TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF);
  const t = (r - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
  return TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * t);
}

/** Level the k-th tower (0-based) is built at. */
export function stageOf(k: number): number {
  return STAGES.find((s) => k < s.towers)?.rcl ?? 8;
}

/** Default radius of a custom "area" target: about an extension field's size. */
const DEFAULT_AREA_RADIUS = 4;

/** A custom target's points: the walkable tiles of an area, or the entrances of a pocket. */
function customPoints(room: Room, target: DefenseTarget): [number, number][] {
  if (target.kind === "entrances") return pocketAround(room, target.x, target.y)?.ring ?? [];
  const terrain = room.getTerrain();
  const radius = target.radius ?? DEFAULT_AREA_RADIUS;
  const points: [number, number][] = [];
  for (let x = target.x - radius; x <= target.x + radius; x++) {
    for (let y = target.y - radius; y <= target.y + radius; y++) {
      if (x > 0 && x < 49 && y > 0 && y < 49 && !isWall(terrain, x, y)) points.push([x, y]);
    }
  }
  return points;
}

/**
 * What towers need to cover, each from the level it exists: the entrances of the pocket around the
 * spawn and the tiles next to the controller (where a claimer would stand) from the start, the core
 * pocket's entrances once its advanced tech arrives (RCL 6), any custom targets from
 * Memory.defenseTargets (e.g. planned extension fields), and the outer ring's breach points.
 */
export function targetGroups(room: Room, outerRing: [number, number][], core?: { ring: [number, number][] }): TargetGroup[] {
  const terrain = room.getTerrain();
  const groups: TargetGroup[] = [];
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const base = spawn && pocketAround(room, spawn.pos.x, spawn.pos.y);
  if (base) groups.push({ name: "spawn pocket", points: base.ring, fromRcl: 3 });

  const controller = room.controller;
  if (controller) {
    const points: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = controller.pos.x + dx;
        const y = controller.pos.y + dy;
        if ((dx || dy) && !isWall(terrain, x, y)) points.push([x, y]);
      }
    }
    groups.push({ name: "controller", points, fromRcl: 3 });
  }
  if (core) groups.push({ name: "core entrances", points: core.ring, fromRcl: CORE_RCL });
  for (const target of Memory.defenseTargets ?? []) {
    if (target.room && target.room !== room.name) continue;
    groups.push({ name: target.name, points: customPoints(room, target), fromRcl: target.fromRcl, custom: true });
  }
  groups.push({ name: "outer ring", points: outerRing, fromRcl: 3 });
  return groups;
}

/**
 * For each tile, how many tiles an attacker could shoot a tower there from: walkable tiles within
 * ATTACK_REACH, assuming the outer ring is breached but the core's inner ring holds (tiles inside
 * the core are ours). Terrain nooks score low, which is the point: no walls of our own to upkeep.
 */
export function exposureMap(room: Room, core?: { anchor: { x: number; y: number }; ring: [number, number][] }): Uint8Array {
  const terrain = room.getTerrain();
  const ring = new Set((core?.ring ?? []).map(([x, y]) => tile(x, y)));
  const pocket = core ? outsideRegion(terrain, ring, [tile(core.anchor.x, core.anchor.y)]) : new Uint8Array(2500);
  const hostile = new Uint8Array(2500);
  for (let t = 0; t < 2500; t++) {
    hostile[t] = Number(!isWall(terrain, Math.floor(t / 50), t % 50) && !pocket[t] && !ring.has(t));
  }
  const exposure = new Uint8Array(2500);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let n = 0;
      for (let dx = -ATTACK_REACH; dx <= ATTACK_REACH; dx++) {
        for (let dy = -ATTACK_REACH; dy <= ATTACK_REACH; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && hostile[tile(nx, ny)]) n++;
        }
      }
      exposure[tile(x, y)] = n;
    }
  }
  return exposure;
}

/** Average total damage over a group's points, given per-point totals so far plus a tower at (x, y). */
function averageWith(g: TargetGroup, totals: number[], x: number, y: number): number {
  let sum = 0;
  g.points.forEach(([px, py], j) => (sum += totals[j] + towerDamage(range(x, y, px, py))));
  return sum / g.points.length;
}

/**
 * Picks tower spots in build order, one stage at a time, each against the pockets active at the
 * level it's built. A pocket's strength is the average total damage over its entrance tiles: what
 * an attacker breaking in faces. Attackers pick the weakest pocket, so a spot scores the weakest
 * active pocket's average, plus OTHERS_WEIGHT of the other pockets' and OUTER_WEIGHT of the outer
 * ring's, minus towerExposureCost per tile an attacker could shoot it from at that level (`exposureAt`:
 * the core only shelters towers once it's walled). Averages alone add up linearly and would stack
 * every tower on one spot; lifting the weakest pocket is what spreads them. Nooks in the rock beat
 * open ground.
 */
export function optimizeTowers(
  candidates: [number, number][],
  groups: TargetGroup[],
  exposureAt: (rcl: number) => Uint8Array,
  count: number,
): TowerSpot[] {
  const totals = groups.map((g) => new Array<number>(g.points.length).fill(0));
  const chosen: TowerSpot[] = [];
  const pool = [...candidates];

  for (let k = 0; k < count && pool.length > 0; k++) {
    const rcl = stageOf(k);
    const pockets = groups.map((g, i) => i).filter((i) => groups[i].name !== OUTER && groups[i].fromRcl <= rcl && groups[i].points.length > 0);
    const outer = groups.findIndex((g) => g.name === OUTER && g.points.length > 0);
    const exposure = exposureAt(rcl);
    const exposureCost = setting("towerExposureCost");
    const score = ([x, y]: [number, number]) => {
      const averages = pockets.map((i) => averageWith(groups[i], totals[i], x, y));
      const weakest = averages.length ? Math.min(...averages) : 0;
      const others = averages.reduce((a, b) => a + b, 0) - weakest;
      const outerAverage = outer >= 0 ? averageWith(groups[outer], totals[outer], x, y) : 0;
      return weakest + OTHERS_WEIGHT * others + OUTER_WEIGHT * outerAverage - exposureCost * exposure[tile(x, y)];
    };
    let best = 0;
    let bestScore = score(pool[0]);
    for (let i = 1; i < pool.length; i++) {
      const s = score(pool[i]);
      if (s > bestScore) {
        best = i;
        bestScore = s;
      }
    }
    const [x, y] = pool.splice(best, 1)[0];
    groups.forEach((g, i) => g.points.forEach(([px, py], j) => (totals[i][j] += towerDamage(range(x, y, px, py)))));
    chosen.push({ x, y, rcl });
  }
  return chosen;
}
