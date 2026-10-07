import { bodyCost } from "../bodies";
import { cachedTravelCost } from "../utils/paths";
import { needsRepair } from "../utils/repair";
import { setting } from "../utils/settings";
import type { Network, Sink, Supply } from "./network";

/** Flows below this many energy per tick count as satisfied. */
const EPSILON = 0.01;
/**
 * A route some free agent is already on looks this much cheaper, so agents only switch when the
 * alternative is clearly better, not on every small swing in demand.
 */
const STICKINESS = 0.8;

/** A drone as the planner sees it: a real creep, or a hypothetical one when sizing the fleet. */
interface Agent {
  name: string;
  work: number;
  carry: number;
  /** Body cost; spread over the creep's life, it's what a route has to earn back. */
  cost: number;
  pos?: RoomPosition;
  route?: Route;
}

export interface Assignment {
  supply: Supply;
  sink: Sink;
  flow: number;
}

/**
 * Ticks for a whole load-spend-return cycle, and the fraction of it the agent holds a loading
 * spot. Normally that's just while loading; but if the sink is in reach of the spot (no travel),
 * the agent never leaves, so it holds the spot the whole time.
 */
function timing(agent: Agent, supply: Supply, sink: Sink): { cycle: number; occupancy: number } {
  const work = Math.max(1, agent.work);
  const load = supply.kind === "source" ? Math.ceil(agent.carry / (work * HARVEST_POWER)) : 1;
  const spend = sink.workPerPart > 0 ? Math.ceil(agent.carry / (work * sink.workPerPart)) : 1;
  // Path cost uses plain = 2, which is about how many ticks a drone takes per plain tile.
  const travel = cachedTravelCost(supply.pos, sink.pos, sink.range);
  const cycle = load + 2 * travel + spend;
  const occupancy = supply.kind !== "source" ? 0 : travel === 0 ? 1 : load / cycle;
  return { cycle, occupancy };
}

/**
 * How much of a source's spot-time the plan may book for creeps that come and go. They arrive in
 * bunches rather than taking perfect turns, and a single spot suffers most: any overlap is a
 * queue. With more spots, bunches even out. Square-root staffing captures this: book
 * c - k * sqrt(c) of c spots, where k = 1 - spotUtilization (the utilization for a single spot).
 */
function bookableSpots(spots: number): number {
  return Math.max(0, spots - (1 - setting("spotUtilization")) * Math.sqrt(spots));
}

/**
 * A source's loading spots. Creeps that never leave (their sink is in reach) each take a whole
 * spot, and can't bunch; creeps that come and go share the rest, with slack for bunching.
 */
interface Spots {
  total: number;
  stationed: number;
  rotating: number;
}

function fits(spots: Spots | undefined, occupancy: number): boolean {
  if (!spots) return true; // stores load in a tick, so they're never the bottleneck
  if (occupancy >= 1) {
    return spots.stationed + 1 <= spots.total && spots.rotating <= bookableSpots(spots.total - spots.stationed - 1) + EPSILON;
  }
  return spots.rotating + occupancy <= bookableSpots(spots.total - spots.stationed) + EPSILON;
}

function book(spots: Spots | undefined, occupancy: number): void {
  if (!spots) return;
  if (occupancy >= 1) spots.stationed++;
  else spots.rotating += occupancy;
}

const onRoute = (agent: Agent, supply: Supply, sink: Sink): boolean => {
  const route = agent.route;
  return route !== undefined && route.from === supply.id && route.kind === sink.kind && route.target === sink.target;
};

/** True if the route still points at things that exist and still need work. */
export function isRouteValid(route: Route | undefined): boolean {
  if (!route || !Game.getObjectById(route.from)) return false;
  if (!route.target) return true;
  const target = Game.getObjectById(route.target);
  if (!target) return false;
  return route.kind !== "repair" || needsRepair(target as Structure);
}

/**
 * Greedy flow assignment, planned from scratch each time. Sinks are served in priority order;
 * within a priority level it repeatedly takes the cheapest (supply, sink) pair (fewest agent-ticks
 * per unit of energy) whose supply still has energy and loading spots, so agents spread across
 * equal-priority sinks and nobody crosses the map while a nearby site goes without. Routes some
 * agent is already on get a STICKINESS discount and are carried by that agent, so routes stay
 * stable between plans; other pairs go to the free agent nearest the supply.
 *
 * Spots are booked through fits/book, leaving slack for creeps arriving in bunches. A route only
 * gets an agent if it delivers at least minRouteReturn times the agent's upkeep (body cost spread
 * over its life); long hauls on a small body aren't worth the creep, or the traffic.
 */
function plan(agents: Agent[], network: Network): Map<string, Assignment> {
  const sinks = [...network.sinks].sort((a, b) => a.priority - b.priority);
  const minReturn = setting("minRouteReturn");
  const supplyLeft = new Map(network.supplies.map((s) => [s.id as string, s.rate]));
  const spots = new Map<string, Spots>();
  for (const s of network.supplies) {
    if (s.kind === "source") spots.set(s.id, { total: s.spots, stationed: 0, rotating: 0 });
  }
  const worthIt = (agent: Agent, cycle: number) =>
    agent.carry / cycle >= (minReturn * agent.cost) / CREEP_LIFE_TIME;
  const demandLeft = new Map(sinks.map((k) => [k.key, k.demand]));
  const assignments = new Map<string, Assignment>();

  const allocate = (agent: Agent, supply: Supply, sink: Sink): boolean => {
    const { cycle, occupancy } = timing(agent, supply, sink);
    if (!isFinite(cycle) || !worthIt(agent, cycle) || !fits(spots.get(supply.id), occupancy)) return false;
    const flow = Math.min(agent.carry / cycle, supplyLeft.get(supply.id)!, demandLeft.get(sink.key)!);
    if (flow <= EPSILON) return false;
    supplyLeft.set(supply.id, supplyLeft.get(supply.id)! - flow);
    book(spots.get(supply.id), occupancy);
    demandLeft.set(sink.key, demandLeft.get(sink.key)! - flow);
    assignments.set(agent.name, { supply, sink, flow });
    return true;
  };

  const pool = [...agents];
  const levels = [...new Set(sinks.map((k) => k.priority))];
  for (const level of levels) {
    const tier = sinks.filter((k) => k.priority === level);
    const failed = new Set<string>();
    while (pool.length > 0) {
      // Cheapest pair in agent-ticks per energy, judged with one agent (bodies are similar).
      const sample = pool[0];
      let best: { supply: Supply; sink: Sink; cost: number } | undefined;
      for (const sink of tier) {
        if (demandLeft.get(sink.key)! <= EPSILON) continue;
        for (const supply of network.supplies) {
          if (failed.has(`${supply.id}>${sink.key}`)) continue;
          if (supplyLeft.get(supply.id)! <= EPSILON) continue;
          const { cycle, occupancy } = timing(sample, supply, sink);
          if (!isFinite(cycle) || !worthIt(sample, cycle) || !fits(spots.get(supply.id), occupancy)) continue;
          const current = pool.some((a) => onRoute(a, supply, sink));
          const cost = (cycle / sample.carry) * (current ? STICKINESS : 1);
          if (!best || cost < best.cost) best = { supply, sink, cost };
        }
      }
      if (!best) break;

      const { supply, sink } = best;
      const range = (a: Agent) => a.pos?.getRangeTo(supply.pos) ?? 0;
      const agent = pool.find((a) => onRoute(a, supply, sink)) ?? pool.reduce((a, b) => (range(b) < range(a) ? b : a));
      if (allocate(agent, supply, sink)) pool.splice(pool.indexOf(agent), 1);
      else failed.add(`${supply.id}>${sink.key}`);
    }
  }
  return assignments;
}

const agentOf = (creep: Creep): Agent => ({
  name: creep.name,
  work: creep.getActiveBodyparts(WORK),
  carry: creep.store.getCapacity(RESOURCE_ENERGY),
  cost: bodyCost(creep.body.map((p) => p.type)),
  pos: creep.pos,
  route: creep.memory.route,
});

/**
 * Plans routes for the room's drones and writes them to memory.route. Drones the plan has no use
 * for (no supply left) get no route. Returns the assignments, keyed by creep name.
 */
export function assignRoutes(drones: Creep[], network: Network): Map<string, Assignment> {
  const assignments = plan(drones.map(agentOf), network);
  for (const drone of drones) {
    const a = assignments.get(drone.name);
    if (a) drone.memory.route = { from: a.supply.id, kind: a.sink.kind, target: a.sink.target };
    else delete drone.memory.route;
  }
  return assignments;
}

/**
 * How many drones with `body` the plan would put to use if it had up to `max` of them: plans for
 * hypothetical drones and counts the ones that get a route.
 */
export function dronesWanted(network: Network, body: BodyPartConstant[], max: number): number {
  const work = body.filter((p) => p === WORK).length;
  const carry = body.filter((p) => p === CARRY).length * CARRY_CAPACITY;
  const cost = bodyCost(body);
  const agents = Array.from({ length: max }, (_, i) => ({ name: `hypothetical-${i}`, work, carry, cost }));
  return plan(agents, network).size;
}
