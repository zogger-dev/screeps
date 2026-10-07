# screeps

TypeScript AI for [Screeps](https://screeps.com). API reference: https://docs.screeps.com/api/

## Setup

Requires Node 18+ (e.g. `nvm install --lts`).

```bash
npm install
cp .screeps.example.json .screeps.json   # then paste your auth token
```

Generate a token at https://screeps.com/a/#!/account/auth-tokens. `.screeps.json` is gitignored.

## Workflow

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run typecheck` | Type-check against `@types/screeps`                 |
| `npm run build`     | Bundle `src/` into `dist/main.js`                   |
| `npm run watch`     | Rebuild on change                                   |
| `npm run deploy`    | Build and upload to the branch in `.screeps.json`   |

To try it in the **Simulation** room, deploy, then select that branch in the Script tab of the simulation.

## Layout

```
src/
  main.ts            game loop: memory cleanup -> per-room managers -> per-creep roles
  types.d.ts         Memory typings (CreepMemory, Role)
  bodies/            body tiers per creep type, one file each (drone, miner, worker, hauler)
  logistics/         energy flow network, lane capacity, route assignment, traffic (docs/logistics.md)
  managers/
    logistics.ts     re-plans drone routes every 50 ticks or when one goes stale
    planner.ts       places construction sites for what the room's RCL allows
    retirement.ts    walks surplus/outdated creeps to a spawn to be recycled
    spawner.ts       demand-based spawn queue per post, tier upgrades, recovery, spawn labels
    towers.ts        defend / heal
  roles/             one file per creep type, registered in roles/index.ts
    drone.ts         WORK~CARRY: runs its planned route (load at a supply, spend on a sink)
    miner.ts         5 WORK, no CARRY: sits on a source container and mines
    worker.ts        WORK-heavy, 1 CARRY: stands by the controller container and upgrades
    hauler.ts        CARRY+MOVE: source container -> spawn/extensions/towers/controller container,
                     then feeds creeps working at sites
  utils/
    census.ts        per-tick creep lists by home room
    construction.ts  build order for construction sites
    energy.ts        working-state toggle, delivery, decaying-energy pickup
    lairs.ts         keeper lair walling: wall spots, enclosure, trapped keepers
    memory.ts        dead-creep / finished-site memory cleanup
    mining.ts        when a source goes static, income, hauler counts
    paths.ts         travel cost between points (roads, swamps, danger zones)
    repair.ts        which structures are worth repairing
    safety.ts        danger zones around hostiles and keeper lairs, safe movement
    settings.ts      tuning knobs overridable from the console
    sources.ts       harvest spots, source and controller containers
    terrain.ts       wall test (terrain is a bitmask)
```

### Creep types and the economy

Creeps are typed by body shape, not job. Any creep can do any task its parts allow; the shape just
makes it better at some. Drones cover for missing miners and workers.

| Type       | Tiers (energy cost)                                 | Best at                                                       |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------- |
| drone      | 2W 1C 1M (300); 3W 2C 3M (550); (2W 1C 1M) x2-4: 600, 900, 1200 | Anything: fill spawn (until haulers exist), upgrade, build, repair, harvest |
| miner      | 5W 1M (550), never bigger                           | Mining a source from its container (RCL 2+)                   |
| worker     | 6W 1C 3M (800); 10W 1C 3M (1200); 15W 2C 4M (1800) | Upgrading from the controller container (RCL 3+)              |
| hauler     | (1C 1M) x2-16: 200 ... 1600                          | Source container -> spawn/extensions/towers -> controller container |

Bodies grow in tiers (`src/bodies/`); the spawner always builds the biggest tier the room can
afford. Miners, haulers and workers are pre-spawned: once one has less life left than its
replacement needs to spawn and walk to its post (plus a margin), the replacement is built, so the
post is never empty. Outdated creeps keep working until up-to-date replacements cover their job, then walk to a
spawn and get recycled.

Sources start with drones harvesting. Once the room can afford a miner and the source's
container is built, the source gets a miner plus enough haulers for its distance, and drones
stop harvesting there. Once static sources exist, the controller container is built and the room
can afford a worker (RCL 3), workers spend a share of that income on upgrading.

### Tuning

The drone/worker mix is meant to be experimented with. Override any knob from the in-game
console; unset keys use the defaults in `utils/settings.ts`:

```js
Memory.settings = { minDrones: 2, maxDrones: 20, spotUtilization: 0.5, minRouteReturn: 3, showRoutes: true, upgradeShare: 0.6 };
```

### Drone logistics

Drones don't pick their own work: a planner (`logistics/`, run by `managers/logistics.ts`) models
the room as a flow network of supplies (sources without a miner, containers, storage) and sinks
(spawn refill, towers, construction, repairs, the controller), and gives each drone a route:
where to load and what to spend on. Capacity lives on the terrain: every tile has lanes (its
cross-section), and the routes through a choke share them. Drones wait for busy supplies at hold
points outside chokes, never inside. Within each priority level it takes the cheapest routes in
creep-time per unit of energy, so nearby work is served first and equal-priority sites share
drones. The spawner builds as many drones as the plan can use (within `minDrones`..`maxDrones`);
drones left without a route are recycled. Set `showRoutes: true` to draw the plan in the room, or
run `logistics("sim")` in the console to print the supplies, sinks and routes.
See [docs/logistics.md](docs/logistics.md) for the model and what's next.

### Keeper lairs

Keepers spawn on their lair's tile, only ever walk to their source, and never attack structures.
From RCL 2 the planner walls every open tile around each lair; builders put those walls up first
(priority -1, 1 energy each) during the window after the tower kills a keeper. The next keeper
spawns trapped, and from then on only tiles within 3 of the lair (its ranged attack) are unsafe,
which can free up the guarded source. Until the lair is enclosed, nothing else is planned or routed near it or its source (and stray
sites there are removed). Towers stop shooting trapped keepers. Only possible in rooms
we own; real Source Keeper rooms can't be claimed.

### Build priorities

Builders work on the highest-priority site first (lower number = sooner), closest first among ties.
Defaults by type: lair walls -1, spawn 0, extension 1, container 1, tower 2, storage 4, other 10, road 20, rampart 30, wall 31.
Override a single site from the in-game console:

```js
Memory.constructionSites = Memory.constructionSites || {};
Memory.constructionSites["<site id>"] = { priority: 0 };
```

Overrides are cleaned up automatically once the site is finished.

### Adding a creep type

1. Add the name to the `CreepType` union in `src/types.d.ts` and its tiers in `src/bodies/<name>.ts` (registered in `src/bodies/index.ts`).
2. Create `src/roles/<name>.ts` exporting a `RoleDef`.
3. Register it in `src/roles/index.ts` and give it steps in `managers/spawner.ts`.
