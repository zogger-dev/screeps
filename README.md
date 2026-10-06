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
  managers/
    planner.ts       places construction sites for what the room's RCL allows
    spawner.ts       population targets + body sizing per room, spawn labels
    towers.ts        defend / heal
  roles/             one file per creep role, registered in roles/index.ts
    harvester.ts     mine -> fill spawn/extensions/towers (falls back to building)
    upgrader.ts      collect energy -> upgrade controller
    builder.ts       collect energy -> build -> repair (falls back to upgrading)
  utils/
    construction.ts  build order for construction sites
    energy.ts        working-state toggle, source assignment, energy collection
    memory.ts        dead-creep / finished-site memory cleanup
    safety.ts        danger zones around hostiles and keeper lairs, safe movement
    sources.ts       harvest spots per source
```

### Build priorities

Builders work on the highest-priority site first (lower number = sooner), closest first among ties.
Defaults by type: spawn 0, extension 1, tower 2, container 3, storage 4, other 10, road 20, rampart 30, wall 31.
Override a single site from the in-game console:

```js
Memory.constructionSites = Memory.constructionSites || {};
Memory.constructionSites["<site id>"] = { priority: 0 };
```

Overrides are cleaned up automatically once the site is finished.

### Adding a role

1. Add the name to the `Role` union in `src/types.d.ts`.
2. Create `src/roles/<name>.ts` exporting a `RoleDef`.
3. Register it in `src/roles/index.ts` and give it a target in `managers/spawner.ts`.
