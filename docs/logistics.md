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

A route is supply -> sink, walking the cached path between them (roads, plain, swamp, danger
zones priced as `moveTo` does). For a creep on it:

- each tile takes ceil(weight x factor / MOVE) ticks to cross, where weight is its non-MOVE parts
  (CARRY only when loaded) and factor is road 0.5, plain 1, swamp 5. A 2W 1C 1M drone takes 3
  ticks per plain tile loaded and 2 empty.
- cycle = load + walking there loaded + spend + walking back empty, where load is
  CARRY / (WORK x 2) at a Source and 1 tick at a store, and spend is CARRY / (WORK x
  energy-per-WORK) at a work sink and 1 tick for a transfer.
- flow = CARRY / cycle, cost = cycle / CARRY (creep-ticks per unit of energy).

## Capacity

Capacity lives on the terrain, not just the endpoints, so a choke caps the traffic of every route
through it together.

- Lanes: each tile's width is the narrowest open run through it along the four axes (its
  cross-section), capped at 5 (`logistics/lanes.ts`). A 1-wide corridor has 1 lane, open ground 5.
- Load: a creep on a route occupies each path tile for the ticks it takes to cross it, out and
  back, i.e. (loaded + empty crossing) / cycle of its time; plus the spend time on the last tile,
  where it works from. Loads from all routes add up per tile.
- Loading spots: harvest spots at a Source, walkable neighbours at a store. A creep holds one for
  load / cycle of the time; if its sink is in reach of the spot (no path), it never leaves and
  holds a whole spot.
- Slack: lanes and spots are servers, and creeps arrive in bunches rather than taking perfect
  turns, so c servers are only booked to c - k * sqrt(c) of their time (square-root staffing),
  with k = 1 - `spotUtilization` (default 0.5): 50% of a single lane or spot, ~71% of three.
  Creeps that never leave take a whole spot (they can't bunch); the slack applies to the rest.
- Worth it: a route only gets a creep if the flow it would actually carry (capped by what's left
  of the supply and the sink's demand) is at least `minRouteReturn` (default 3) times the creep's
  upkeep, body cost / 1500 per tick. So crumbs of leftover supply or demand don't each get a
  creep, and slow small-CARRY drones stay off long hauls, which miners and haulers do better.
  Finite jobs (construction, repairs) are judged on the flow the creep can carry rather than the
  job's remaining demand: the creep works it at full speed and is reassigned when it's done, so a
  site near completion still gets finished.

The best plan meets demand in priority order at the lowest total creep-time. Special cases fall
out of it: a container site next to a Source is a near-zero-travel route, so that Source's energy
goes to it first, carried by however many creeps its spots and energy allow.

## Traffic

Planning sets how many creeps use each route; `logistics/traffic.ts` keeps them from colliding:

- Hold points: a route whose supply sits behind a choke (a tile 3 lanes wide or less) records the
  first wide tile on the way back from it. Creeps wait there, never inside the choke, where
  waiting would block traffic both ways. Creeps already past the hold point carry on.
- Spot bookings: each tick, a Source's spots are booked by arrival time. Creeps next to it keep
  their spot until full (miners for good); inbound creeps queue by ETA and take the first spot to
  free up. A creep only sets off from its hold point if its spot will be free within 3 ticks of
  arriving.
- Parking: creeps waiting for a full spawn or an empty container stay put in open ground, but step
  out of chokes to the nearest open tile.

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
4. Started: haulers with nowhere else to deliver feed creeps working at sites (drones at their build,
   repair or upgrade target, and upgrade workers) by walking up and transferring (range 1). Haulers
   claim a creep once it's down to half its energy; a drone that runs dry waits for its hauler if
   the hauler will arrive before the drone could walk to its supply, load and come back. Haulers
   commit to one pickup and one dropoff at a time (spawn/extensions/towers, then stocking, then
   feeding; skipping targets another hauler claimed) and only re-decide once it's done, so they
   don't flip between targets as the room changes. Not planned yet: the planner doesn't know
   about it, so drone cycles still assume the walk back. Next: model it as a pseudo-node near
   clusters of construction sites.

## Known limits

- Paths are fixed: a saturated choke blocks a route even if a longer way around exists. A full
  min-cost flow solver would split traffic across alternative paths.
- Lane width is a per-tile estimate; an isolated pillar can make open ground look narrower.
- Priority beats cost: a high-priority sink gets energy from a far supply before a lower-priority
  sink gets it from a near one. There's no cap on how expensive a route may be.
- Bodies are assumed similar when comparing routes; costs are judged with one sample drone.
- Travel is computed from body and terrain, not measured; swapping and jostling aren't modelled.
