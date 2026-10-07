# Logistics network

The room's energy economy is modelled as a flow network, and creeps are assigned to routes
through it, instead of each role deciding for itself where to get and spend energy.

## Nodes

| Node      | Role                                  | Examples                                                   |
| --------- | ------------------------------------- | ---------------------------------------------------------- |
| Source    | Supply: 10/tick, limited by harvest spots | Sources without a miner                                 |
| Store     | Sink and supply (a buffer)            | Source containers, controller container, storage; piles and tombstones as supply only |
| Consumer  | Sink that takes energy directly       | Spawn + extensions (one pseudo-node at the spawn), towers  |
| Work sink | Sink that needs energy and WORK on site | Construction sites, repairs, the controller              |

Rates are energy per tick. Finite amounts become rates over a horizon: a refill shortfall over
50 ticks, a stockpile over 100, construction and repair over 300. The controller has unlimited
demand at the lowest priority and absorbs whatever is left.

## Routes and cost

A route is supply -> sink. For a creep on it:

- cycle = load + 2 x travel + spend, where load is CARRY / (WORK x 2) at a Source and 1 tick at a
  store, spend is CARRY / (WORK x energy-per-WORK) at a work sink and 1 tick for a transfer, and
  travel is the path cost (roads 1, plain 2, swamp 10, danger zones expensive).
- flow = CARRY / cycle, cost = cycle / CARRY (creep-ticks per unit of energy).
- at a Source, the creep holds a spot for load / cycle of the time, so a single-spot source can
  serve several creeps on long routes. If the sink is in reach of the spot (no travel), the creep
  never leaves, so it holds the spot full-time. Creeps arrive in bunches rather than taking perfect
  turns, so a source with c spots is only booked to c - k * sqrt(c) of their time (square-root
  staffing), with k = 1 - `spotUtilization` (default 0.5): 50% of a single spot, ~71% of three.
  Creeps that never leave each take a whole spot (they can't bunch), and the slack applies to the
  remaining spots.
- a route only gets a creep if its flow is at least `minRouteReturn` (default 2) times the creep's
  upkeep, body cost / 1500 per tick. A 300-energy drone needs 0.4/tick, i.e. a cycle under ~125
  ticks; longer hauls are left to miners and haulers.

The best plan meets demand in priority order at the lowest total creep-time. Special cases fall
out of it: a container site next to a Source is a near-zero-travel route, so that Source's energy
goes to it first, carried by however many creeps its spots and energy allow.

## Creeps

Each creep type carries the flows it's most efficient at:

- miner: Source -> its container (zero travel).
- hauler: store -> consumer or work sink; highest flow per creep-time on those routes, so the
  assigner should give them those routes first.
- drone: Source or store -> anything; fills whatever the specialists don't cover.
- worker: supplies WORK at a work sink and receives energy rather than carrying it.

## Assignment

Greedy, planned from scratch every 50 ticks or when a drone's route becomes invalid
(`logistics/assign.ts`). Sinks are served in priority order; within a priority level it repeatedly
takes the cheapest (supply, sink) pair that still has supply, spots and demand. Each pair goes to
a drone already on that exact route if possible, else the free drone nearest the supply, so routes
only change when the optimal plan does.

## Phases

1. Done: drones get routes (`logistics/`, `managers/logistics.ts`). Miners, haulers and workers keep
   their own behaviour; their flows are subtracted from the network (haulers feeding the spawn,
   miners feeding their containers).
2. Done: the spawner sizes drones from the plan. The planner plans for hypothetical drones and counts
   how many get a route; drones left without a route are recycled (never below `minDrones`).
3. Miners, haulers and workers become flows in the network too, with haulers getting store -> sink
   routes first.
4. Later: hauler -> work-site hand-off, via a pseudo-node near clusters of construction sites.

## Known limits

- Priority beats cost: a high-priority sink gets energy from a far supply before a lower-priority
  sink gets it from a near one. There's no cap on how expensive a route may be.
- Bodies are assumed similar when comparing routes; costs are judged with one sample drone.
- Travel is estimated from path cost, not measured; traffic and queueing aren't modelled.
