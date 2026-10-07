import { bodyCost } from "../bodies";
import { ticksPerTile } from "../utils/movement";
import { cachedLeg, type Leg } from "../utils/paths";
import { needsRepair } from "../utils/repair";
import { isSafe, isSafeSoon } from "../utils/safety";
import { setting } from "../utils/settings";
import { CHOKE_LANES } from "./lanes";
import type { Network, Sink, Supply } from "./network";

/** Flows below this many energy per tick count as satisfied. */
const EPSILON = 0.01;
/**
 * A route some free agent is already on looks this much cheaper, so agents only switch when the
 * alternative is clearly better, not on every small swing in demand.
 */
const STICKINESS = 0.8;
/** Finite jobs within this range of each other form a cluster, served by one creep if need be. */
const CLUSTER_RANGE = 3;

/** A drone as the planner sees it: a real creep, or a hypothetical one when sizing the fleet. */
interface Agent {
  name: string;
  work: number;
  carryParts: number;
  move: number;
  /** Parts other than WORK, CARRY and MOVE: they add fatigue too. */
  other: number;
  /** Energy it carries when full. */
  carry: number;
  /** Body cost; spread over the creep's life, it's what a route has to earn back. */
  cost: number;
  pos?: RoomPosition;
  /** Carrying energy already, so it starts a new route at the sink end rather than the supply. */
  loaded?: boolean;
  route?: Route;
}

export interface Assignment {
  supply: Supply;
  sink: Sink;
  flow: number;
  hold?: { x: number; y: number };
}

/** What a route costs an agent per cycle, and what it takes from the loading spot and the path. */
interface Timing {
  cycle: number;
  /** Fraction of the cycle the agent holds a loading spot. */
  occupancy: number;
  /** Fraction of the cycle the agent occupies each path tile, keyed by x * 50 + y. */
  tiles: Map<number, number>;
}

/**
 * Walks the route tile by tile: loaded out to the sink, empty back. The cycle is loading +
 * walking + spending; each tile is occupied while crossing it both ways, and the last one while
 * spending (the creep works from there). If the sink is in reach of the loading spot (no path),
 * the agent never leaves, so it holds the spot the whole time.
 */
function timing(agent: Agent, supply: Supply, sink: Sink, leg: Leg): Timing {
  if (!isFinite(leg.cost)) return { cycle: Infinity, occupancy: 1, tiles: new Map() };
  const work = Math.max(1, agent.work);
  const load = supply.kind === "source" ? Math.ceil(agent.carry / (work * HARVEST_POWER)) : 1;
  const spend = sink.workPerPart > 0 ? Math.ceil(agent.carry / (work * sink.workPerPart)) : 1;

  const loaded = agent.work + agent.carryParts + agent.other;
  const empty = agent.work + agent.other;
  const crossings = leg.tiles.map((t) => ticksPerTile(loaded, agent.move, t.factor) + ticksPerTile(empty, agent.move, t.factor));
  const cycle = load + crossings.reduce((a, b) => a + b, 0) + spend;

  const tiles = new Map<number, number>();
  leg.tiles.forEach((t, i) => {
    const dwell = crossings[i] + (i === leg.tiles.length - 1 ? spend : 0);
    tiles.set(t.x * 50 + t.y, (tiles.get(t.x * 50 + t.y) ?? 0) + dwell / cycle);
  });
  return { cycle, occupancy: leg.tiles.length === 0 ? 1 : load / cycle, tiles };
}

/**
 * Where an agent should wait for a supply behind a choke: the first wide tile on the way back
 * from it. None if the supply's surroundings are already wide, or there's no wide tile at all.
 */
function holdPoint(leg: Leg, lanes: Network["lanes"]): { x: number; y: number } | undefined {
  if (leg.tiles.length === 0 || lanes(leg.tiles[0].x, leg.tiles[0].y) > CHOKE_LANES) return undefined;
  const wide = leg.tiles.find((t) => lanes(t.x, t.y) > CHOKE_LANES);
  return wide && { x: wide.x, y: wide.y };
}

const onRoute = (agent: Agent, supply: Supply, sink: Sink): boolean => {
  const route = agent.route;
  return route !== undefined && route.from === supply.id && route.kind === sink.kind && route.target === sink.target;
};

/**
 * True if the route still points at things that exist and still need work, and a site or repair
 * it works at is still safe: a site may also be about to become safe (a keeper dying of old age),
 * since its creep waits outside until it is. When a keeper lair's walls stop being safe because the
 * keeper is due back, the creep is re-planned away rather than walking into it.
 */
export function isRouteValid(route: Route | undefined): boolean {
  if (!route || !Game.getObjectById(route.from)) return false;
  if (!route.target) return true;
  const target = Game.getObjectById(route.target);
  if (!target) return false;
  if (route.kind === "build" && !isSafeSoon(target.pos)) return false;
  if (route.kind === "repair" && !isSafe(target.pos)) return false;
  return route.kind !== "repair" || needsRepair(target as Structure);
}

/**
 * How much of c servers' time the plan may book. Creeps arrive in bunches rather than taking
 * perfect turns, and a single server (a loading spot, or a lane through a choke) suffers most:
 * any overlap is a queue. With more, bunches even out. Square-root staffing captures this: book
 * c - k * sqrt(c), where k = 1 - spotUtilization (the utilization for a single server).
 */
function bookable(servers: number): number {
  return Math.max(0, servers - (1 - setting("spotUtilization")) * Math.sqrt(servers));
}

/**
 * A supply's loading spots. Creeps that never leave (their sink is in reach) each take a whole
 * spot, and can't bunch; creeps that come and go share the rest, with slack for bunching.
 */
interface Spots {
  total: number;
  stationed: number;
  rotating: number;
}

function fitsSpots(spots: Spots, occupancy: number): boolean {
  if (occupancy >= 1) {
    return spots.stationed + 1 <= spots.total && spots.rotating <= bookable(spots.total - spots.stationed - 1) + EPSILON;
  }
  return spots.rotating + occupancy <= bookable(spots.total - spots.stationed) + EPSILON;
}

function bookSpots(spots: Spots, occupancy: number): void {
  if (occupancy >= 1) spots.stationed++;
  else spots.rotating += occupancy;
}

/**
 * Greedy flow assignment, planned from scratch each time. Sinks are served in priority order;
 * within a priority level it repeatedly takes the cheapest (supply, sink) pair (fewest agent-ticks
 * per unit of energy), so agents spread across equal-priority sinks and nobody crosses the map
 * while a nearby site goes without. Routes some agent is already on get a STICKINESS discount and
 * are carried by that agent, so routes stay stable between plans; other pairs go to the free agent
 * nearest the supply.
 *
 * Capacity: loading spots and every tile along a route are booked with slack for bunching
 * (`bookable`), a tile having as many servers as it has lanes. So a choke caps the traffic of all
 * routes through it together, whichever supplies and sinks they join. An agent is only assigned if
 * the flow it would actually carry (capped by what's left of the supply and the sink's demand) is
 * at least minRouteReturn times its upkeep: long hauls on a small body, or crumbs of leftover
 * supply or demand, aren't worth a creep or the traffic it adds.
 */
function plan(agents: Agent[], network: Network): Map<string, Assignment> {
  const sinks = [...network.sinks].sort((a, b) => a.priority - b.priority);
  const minReturn = setting("minRouteReturn");
  const supplyLeft = new Map(network.supplies.map((s) => [s.id as string, s.rate]));
  const spots = new Map(network.supplies.map((s) => [s.id as string, { total: s.spots, stationed: 0, rotating: 0 }]));
  const demandLeft = new Map(sinks.map((k) => [k.key, k.demand]));
  const tileLoad = new Map<number, number>();
  const assignments = new Map<string, Assignment>();

  const legOf = (supply: Supply, sink: Sink) => cachedLeg(supply.pos, sink.pos, sink.range);
  const timings = new Map<string, Timing>();
  const timingOf = (agent: Agent, supply: Supply, sink: Sink): Timing => {
    const key = `${supply.id}>${sink.key}|${agent.work},${agent.carryParts},${agent.move},${agent.other}`;
    let t = timings.get(key);
    if (!t) {
      t = timing(agent, supply, sink, legOf(supply, sink));
      timings.set(key, t);
    }
    return t;
  };

  /** What the agent would actually carry on supply -> sink, given what's left of both. */
  const flowOf = (agent: Agent, supply: Supply, sink: Sink, cycle: number) =>
    Math.min(agent.carry / cycle, supplyLeft.get(supply.id)!, demandLeft.get(sink.key)!);
  /**
   * Whether the route earns its creep. For a continuous sink (refill, upgrading) a sliver of
   * leftover demand doesn't justify a whole creep. A finite job (building, repairing) is different:
   * the creep works it at full speed until it's done and is then reassigned, so it's judged on the
   * flow it can carry, or a site near completion would never get finished.
   */
  const worthIt = (agent: Agent, supply: Supply, sink: Sink, cycle: number) => {
    // A cluster of finite jobs nobody covers yet gets its first creep however far away it is:
    // we placed those sites to get them built, and some (keeper lair walls, 1 energy each) are
    // worth far more than the energy they take. Extra creeps still have to earn their keep.
    if (sink.finite && !clusterCovered(sink)) return true;
    const flow = sink.finite
      ? Math.min(agent.carry / cycle, supplyLeft.get(supply.id)!)
      : flowOf(agent, supply, sink, cycle);
    return flow >= (minReturn * agent.cost) / CREEP_LIFE_TIME;
  };
  const clusterCovered = (sink: Sink) =>
    [...assignments.values()].some((a) => a.sink.finite && a.sink.pos.getRangeTo(sink.pos) <= CLUSTER_RANGE);
  /**
   * True if a sink could use another creep. A finite job with no creep still needs one however
   * small its rate: a wall is 1 energy over the whole horizon, but it doesn't build itself.
   */
  const wantsMore = (sink: Sink) =>
    demandLeft.get(sink.key)! > EPSILON || (sink.finite && ![...assignments.values()].some((a) => a.sink === sink));
  const fitsPath = (t: Timing) =>
    [...t.tiles].every(([k, load]) => (tileLoad.get(k) ?? 0) + load <= bookable(network.lanes(Math.floor(k / 50), k % 50)) + EPSILON);
  const feasible = (agent: Agent, supply: Supply, sink: Sink, t: Timing) =>
    isFinite(t.cycle) &&
    fitsSpots(spots.get(supply.id)!, t.occupancy) &&
    worthIt(agent, supply, sink, t.cycle) &&
    fitsPath(t);

  const allocate = (agent: Agent, supply: Supply, sink: Sink): boolean => {
    const t = timingOf(agent, supply, sink);
    if (!feasible(agent, supply, sink, t)) return false;
    const flow = flowOf(agent, supply, sink, t.cycle);
    supplyLeft.set(supply.id, supplyLeft.get(supply.id)! - flow);
    demandLeft.set(sink.key, demandLeft.get(sink.key)! - flow);
    bookSpots(spots.get(supply.id)!, t.occupancy);
    for (const [k, load] of t.tiles) tileLoad.set(k, (tileLoad.get(k) ?? 0) + load);
    assignments.set(agent.name, { supply, sink, flow, hold: holdPoint(legOf(supply, sink), network.lanes) });
    return true;
  };

  const pool = [...agents];
  const levels = [...new Set(sinks.map((k) => k.priority))];
  for (const level of levels) {
    const tier = sinks.filter((k) => k.priority === level);
    const failed = new Set<string>();
    while (pool.length > 0) {
      // Cheapest feasible pair in agent-ticks per energy, judged with one agent (bodies are similar).
      const sample = pool[0];
      let best: { supply: Supply; sink: Sink; cost: number } | undefined;
      for (const sink of tier) {
        if (!wantsMore(sink)) continue;
        for (const supply of network.supplies) {
          if (failed.has(`${supply.id}>${sink.key}`) || supplyLeft.get(supply.id)! <= EPSILON) continue;
          const t = timingOf(sample, supply, sink);
          if (!feasible(sample, supply, sink, t)) continue;
          const current = pool.some((a) => onRoute(a, supply, sink));
          const cost = (t.cycle / sample.carry) * (current ? STICKINESS : 1);
          if (!best || cost < best.cost) best = { supply, sink, cost };
        }
      }
      if (!best) break;

      const { supply, sink } = best;
      // The free agent closest to where it would start: the sink if it's already loaded (e.g. one
      // that just finished the wall next door), the supply if it's empty.
      const range = (a: Agent) => a.pos?.getRangeTo(a.loaded ? sink.pos : supply.pos) ?? 0;
      const agent = pool.find((a) => onRoute(a, supply, sink)) ?? pool.reduce((a, b) => (range(b) < range(a) ? b : a));
      if (allocate(agent, supply, sink)) pool.splice(pool.indexOf(agent), 1);
      else failed.add(`${supply.id}>${sink.key}`);
    }
  }
  return assignments;
}

function agentOf(creep: Creep): Agent {
  const count = (part: BodyPartConstant) => creep.getActiveBodyparts(part);
  return {
    name: creep.name,
    work: count(WORK),
    carryParts: count(CARRY),
    move: count(MOVE),
    other: creep.body.filter((p) => p.hits > 0 && p.type !== WORK && p.type !== CARRY && p.type !== MOVE).length,
    carry: creep.store.getCapacity(RESOURCE_ENERGY),
    cost: bodyCost(creep.body.map((p) => p.type)),
    pos: creep.pos,
    loaded: creep.memory.working && creep.store[RESOURCE_ENERGY] > 0,
    route: creep.memory.route,
  };
}

/**
 * Plans routes for the room's drones and writes them to memory.route. Drones the plan has no use
 * for (no supply left) get no route. Returns the assignments, keyed by creep name.
 */
export function assignRoutes(drones: Creep[], network: Network): Map<string, Assignment> {
  const assignments = plan(drones.map(agentOf), network);
  for (const drone of drones) {
    const a = assignments.get(drone.name);
    if (a) drone.memory.route = { from: a.supply.id, kind: a.sink.kind, target: a.sink.target, hold: a.hold };
    else delete drone.memory.route;
  }
  return assignments;
}

/**
 * How many drones with `body` the plan would put to use if it had up to `max` of them: plans for
 * hypothetical drones and counts the ones that get a route.
 */
export function dronesWanted(network: Network, body: BodyPartConstant[], max: number): number {
  const count = (part: BodyPartConstant) => body.filter((p) => p === part).length;
  const agent = {
    work: count(WORK),
    carryParts: count(CARRY),
    move: count(MOVE),
    other: body.length - count(WORK) - count(CARRY) - count(MOVE),
    carry: count(CARRY) * CARRY_CAPACITY,
    cost: bodyCost(body),
  };
  const agents = Array.from({ length: max }, (_, i) => ({ ...agent, name: `hypothetical-${i}` }));
  return plan(agents, network).size;
}
