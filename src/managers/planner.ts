import { isContested, isLairWallSpot, keeperLairs, lairWallSpots } from "../utils/lairs";
import { avoidThreats, isSafe, safeSources } from "../utils/safety";
import { sourceContainer } from "../utils/sources";
import { isWall } from "../utils/terrain";

/** Placement is cheap, but there's no need to re-plan every tick. */
const PLAN_INTERVAL = 25;
/** Cap on our open sites per room so builders finish things instead of spreading thin. */
const MAX_PENDING_SITES = 5;
/**
 * Roads get a separate cap. They're the lowest build priority, so if they shared the main cap,
 * a batch of road sites would block containers and extensions until every road was finished.
 */
const MAX_PENDING_ROADS = 3;
/** How far from the spawn the structure grid may extend. */
const MAX_GRID_RANGE = 12;
/** Roads and containers cost a lot of build energy; skip them until extensions are available. */
const INFRASTRUCTURE_RCL = 2;

/** Blocking structures placed on the checkerboard grid around the spawn, in placement order. */
const GRID_STRUCTURES: BuildableStructureConstant[] = [
  STRUCTURE_SPAWN,
  STRUCTURE_TOWER,
  STRUCTURE_EXTENSION,
  STRUCTURE_STORAGE,
];

interface PlanContext {
  room: Room;
  rcl: number;
  anchor: RoomPosition;
  terrain: RoomTerrain;
  /** Tiles holding a structure or construction site. */
  occupied: Set<number>;
  /** Tiles kept clear: next to sources/minerals (harvest spots) and the controller (upgrade spots). */
  reserved: Set<number>;
  /** Walkable tiles creeps can reach from the anchor. */
  reachable: Set<number>;
  /** How many more non-road sites we may place this run. */
  budget: number;
  /** How many more road sites we may place this run. */
  roadBudget: number;
}

const key = (x: number, y: number) => x * 50 + y;
const isRoad = (s: ConstructionSite) => s.structureType === STRUCTURE_ROAD;
/** Sites that count against MAX_PENDING_SITES: not roads, and not lair walls (placed all at once). */
const isBudgeted = (s: ConstructionSite) =>
  !isRoad(s) && !(s.structureType === STRUCTURE_WALL && isLairWallSpot(s.pos));

const isObstacle = (type: string) => (OBSTACLE_OBJECT_TYPES as readonly string[]).includes(type);

/**
 * Flood fill from the anchor over walkable tiles: not natural walls, obstacle structures, or
 * sites that will become obstacles. A structure is only useful where creeps can get next to it.
 */
function reachableFrom(room: Room, anchor: RoomPosition, terrain: RoomTerrain): Set<number> {
  const blocked = new Set<number>();
  for (const s of room.find(FIND_STRUCTURES)) if (isObstacle(s.structureType)) blocked.add(key(s.pos.x, s.pos.y));
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) if (isObstacle(s.structureType)) blocked.add(key(s.pos.x, s.pos.y));

  const reachable = new Set<number>();
  const queue: [number, number][] = [[anchor.x, anchor.y]];
  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        const k = key(x, y);
        if (x < 0 || x > 49 || y < 0 || y > 49 || reachable.has(k) || blocked.has(k) || isWall(terrain, x, y)) continue;
        reachable.add(k);
        queue.push([x, y]);
      }
    }
  }
  return reachable;
}

/** True if a creep can stand next to (x, y), i.e. a structure there could be built and used. */
function touchesReachable(ctx: PlanContext, x: number, y: number): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if ((dx || dy) && ctx.reachable.has(key(x + dx, y + dy))) return true;
    }
  }
  return false;
}

function createContext(room: Room, anchor: RoomPosition): PlanContext {
  const occupied = new Set<number>();
  for (const s of room.find(FIND_STRUCTURES)) occupied.add(key(s.pos.x, s.pos.y));
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) occupied.add(key(s.pos.x, s.pos.y));

  const reserved = new Set<number>();
  const keepClear: RoomObject[] = [...room.find(FIND_SOURCES), ...room.find(FIND_MINERALS)];
  if (room.controller) keepClear.push(room.controller);
  for (const { pos } of keepClear) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) reserved.add(key(pos.x + dx, pos.y + dy));
  }

  const terrain = room.getTerrain();
  return {
    room,
    rcl: room.controller?.level ?? 0,
    anchor,
    terrain,
    occupied,
    reserved,
    reachable: reachableFrom(room, anchor, terrain),
    budget: MAX_PENDING_SITES - room.find(FIND_MY_CONSTRUCTION_SITES, { filter: isBudgeted }).length,
    roadBudget: MAX_PENDING_ROADS - room.find(FIND_MY_CONSTRUCTION_SITES, { filter: isRoad }).length,
  };
}

/**
 * Free, buildable tile creeps can get next to, away from room exits, harvest/upgrade spots,
 * danger and unwalled keepers.
 */
function isOpen(ctx: PlanContext, x: number, y: number): boolean {
  return (
    x >= 2 &&
    x <= 47 &&
    y >= 2 &&
    y <= 47 &&
    !isWall(ctx.terrain, x, y) &&
    !ctx.occupied.has(key(x, y)) &&
    !ctx.reserved.has(key(x, y)) &&
    touchesReachable(ctx, x, y) &&
    isSafe(new RoomPosition(x, y, ctx.room.name)) &&
    !isContested(new RoomPosition(x, y, ctx.room.name))
  );
}

function place(ctx: PlanContext, x: number, y: number, type: BuildableStructureConstant): boolean {
  const road = type === STRUCTURE_ROAD;
  if ((road ? ctx.roadBudget : ctx.budget) <= 0 || ctx.room.createConstructionSite(x, y, type) !== OK) return false;
  if (road) ctx.roadBudget--;
  else ctx.budget--;
  ctx.occupied.add(key(x, y));
  return true;
}

/** How many more of `type` the current RCL allows, counting built structures and pending sites. */
function allowance(ctx: PlanContext, type: BuildableStructureConstant): number {
  const allowed = CONTROLLER_STRUCTURES[type][ctx.rcl] ?? 0;
  const built = ctx.room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === type }).length;
  const pending = ctx.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => s.structureType === type }).length;
  return allowed - built - pending;
}

/**
 * Open tiles on a checkerboard around the spawn, nearest first. Only tiles matching the spawn's
 * parity are used, so the other half stays free as diagonal walking lanes and structures can
 * never wall off a path. Range starts at 2 to keep the spawn's neighbours clear for new creeps.
 */
function gridSpots(ctx: PlanContext): [number, number][] {
  const { x: ax, y: ay } = ctx.anchor;
  const spots: [number, number][] = [];
  for (let r = 2; r <= MAX_GRID_RANGE; r++) {
    for (let x = ax - r; x <= ax + r; x++) {
      for (let y = ay - r; y <= ay + r; y++) {
        if (Math.max(Math.abs(x - ax), Math.abs(y - ay)) !== r) continue;
        if ((x + y) % 2 !== (ax + ay) % 2) continue;
        if (isOpen(ctx, x, y)) spots.push([x, y]);
      }
    }
  }
  return spots;
}

function planGrid(ctx: PlanContext): void {
  const spots = gridSpots(ctx);
  for (const type of GRID_STRUCTURES) {
    let wanted = allowance(ctx, type);
    while (wanted > 0 && ctx.budget > 0 && spots.length > 0) {
      const [x, y] = spots.shift()!;
      if (place(ctx, x, y, type)) wanted--;
    }
  }
}

/**
 * A container next to each safe source, on the side nearest the spawn. A source only switches to
 * a static miner once its container is built, so these go down as soon as containers are worth it.
 */
function planSourceContainers(ctx: PlanContext): void {
  for (const source of safeSources(ctx.room)) {
    if (allowance(ctx, STRUCTURE_CONTAINER) <= 0 || ctx.budget <= 0) return;
    const pending = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (sourceContainer(source) || pending.length > 0) continue;

    // Harvest-spot tiles are reserved for other structures, so check them directly here.
    let best: [number, number] | null = null;
    let bestRange = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (isWall(ctx.terrain, x, y) || ctx.occupied.has(key(x, y)) || !ctx.reachable.has(key(x, y))) continue;
        // The miner stands on this tile all its life, so it has to be clear of any trapped keeper.
        if (!isSafe(new RoomPosition(x, y, ctx.room.name))) continue;
        const range = ctx.anchor.getRangeTo(x, y);
        if (range < bestRange) {
          best = [x, y];
          bestRange = range;
        }
      }
    }
    if (best) place(ctx, best[0], best[1], STRUCTURE_CONTAINER);
  }
}

/**
 * Walls on every open tile around each keeper lair, trapping future keepers on the lair. Builders
 * only reach these sites while the keeper is dead (see isSafe), and build them first (see
 * utils/construction.ts).
 */
function planLairWalls(ctx: PlanContext): void {
  if (allowance(ctx, STRUCTURE_WALL) <= 0) return;
  for (const lair of keeperLairs(ctx.room)) {
    for (const pos of lairWallSpots(lair)) {
      // The whole ring at once, outside the pending-site budget: walls cost 1 energy each and can
      // only be built in the window between keepers, so they should all be ready when it opens.
      if (!ctx.occupied.has(key(pos.x, pos.y)) && ctx.room.createConstructionSite(pos.x, pos.y, STRUCTURE_WALL) === OK) {
        ctx.occupied.add(key(pos.x, pos.y));
      }
    }
  }
}

/** One container within upgrade range of the controller, on the side nearest the spawn. */
function planControllerContainer(ctx: PlanContext): void {
  const controller = ctx.room.controller;
  if (!controller || allowance(ctx, STRUCTURE_CONTAINER) <= 0) return;
  const isContainer = (s: Structure | ConstructionSite) => s.structureType === STRUCTURE_CONTAINER;
  if (
    controller.pos.findInRange(FIND_STRUCTURES, 3, { filter: isContainer }).length > 0 ||
    controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, { filter: isContainer }).length > 0
  ) {
    return;
  }

  let best: [number, number] | null = null;
  let bestRange = Infinity;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const x = controller.pos.x + dx;
      const y = controller.pos.y + dy;
      if (!isOpen(ctx, x, y)) continue;
      const range = ctx.anchor.getRangeTo(x, y);
      if (range < bestRange) {
        best = [x, y];
        bestRange = range;
      }
    }
  }
  if (best) place(ctx, best[0], best[1], STRUCTURE_CONTAINER);
}

/** Roads from the spawn to each safe source and the controller. */
function planRoads(ctx: PlanContext): void {
  const destinations: RoomObject[] = [...safeSources(ctx.room)];
  if (ctx.room.controller) destinations.push(ctx.room.controller);

  for (const dest of destinations) {
    if (ctx.roadBudget <= 0) return;
    const { path } = PathFinder.search(
      ctx.anchor,
      { pos: dest.pos, range: 1 },
      { plainCost: 2, swampCost: 10, maxRooms: 1, roomCallback: (roomName) => roadCosts(roomName) },
    );
    for (const step of path) {
      if (ctx.roadBudget <= 0) return;
      if (!ctx.occupied.has(key(step.x, step.y)) && isSafe(step) && !isContested(step)) {
        place(ctx, step.x, step.y, STRUCTURE_ROAD);
      }
    }
  }
}

/** Prefer existing roads, path around blocking structures/sites and danger zones. */
function roadCosts(roomName: string): CostMatrix | false {
  const room = Game.rooms[roomName];
  if (!room) return false;
  const costs = new PathFinder.CostMatrix();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) costs.set(s.pos.x, s.pos.y, 1);
    else if (s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_RAMPART) {
      costs.set(s.pos.x, s.pos.y, 0xff);
    }
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
    if (s.structureType === STRUCTURE_ROAD) costs.set(s.pos.x, s.pos.y, 1);
    else if (s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_RAMPART) {
      costs.set(s.pos.x, s.pos.y, 0xff);
    }
  }
  avoidThreats(roomName, costs);
  return costs;
}

/**
 * Removes our construction sites (other than lair walls) in reach of an unwalled keeper. They
 * could only be worked between keeper lives, and the source they serve isn't usable yet anyway.
 */
function removeContestedSites(room: Room): void {
  for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
    if (site.structureType !== STRUCTURE_WALL && isContested(site.pos)) site.remove();
  }
}

/**
 * Removes our construction sites no creep can get next to, e.g. one placed in a pocket of walls
 * by an earlier version. Left alone, they'd count as pending forever and block a replacement.
 */
function removeUnreachableSites(ctx: PlanContext): void {
  for (const site of ctx.room.find(FIND_MY_CONSTRUCTION_SITES)) {
    const { x, y } = site.pos;
    if (!ctx.reachable.has(key(x, y)) && !touchesReachable(ctx, x, y)) site.remove();
  }
}

/**
 * Places construction sites for whatever the room's RCL allows but doesn't have yet.
 * Builders pick them up in the order set by utils/construction.ts.
 */
export function runPlanner(room: Room): void {
  if (Game.time % PLAN_INTERVAL !== 0) return;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  removeContestedSites(room);
  const ctx = createContext(room, spawn.pos);
  removeUnreachableSites(ctx);

  // Lair walls and source containers go first: with only MAX_PENDING_SITES at a time,
  // extensions would otherwise take every slot. Walls unlock at RCL 2 (allowance checks).
  planLairWalls(ctx);
  if (ctx.rcl >= INFRASTRUCTURE_RCL) planSourceContainers(ctx);
  planGrid(ctx);
  if (ctx.rcl >= INFRASTRUCTURE_RCL) {
    planControllerContainer(ctx);
    planRoads(ctx);
  }
}
