import { towerReport } from "./defense/evaluate";
import { coreReport, defenseReport, drawCore, drawDefense } from "./defense/report";
import { logisticsReport } from "./logistics/report";
import { drawZones, terrainExport, zonesReport } from "./plan/report";
import { runLogistics } from "./managers/logistics";
import { runPlanner } from "./managers/planner";
import { runRetirement } from "./managers/retirement";
import { runSpawner } from "./managers/spawner";
import { runTowers } from "./managers/towers";
import { roles } from "./roles";
import { cleanMemory } from "./utils/memory";

// Console helpers, e.g. `logistics("sim")`, `defense("sim")`, `core("sim")`, `towers("sim")`, `zones("sim")`.
Object.assign(globalThis, {
  logistics: logisticsReport,
  defense: defenseReport,
  core: coreReport,
  towers: towerReport,
  zones: zonesReport,
  terrain: terrainExport,
});

export const loop = (): void => {
  cleanMemory();

  for (const room of Object.values(Game.rooms)) {
    if (!room.controller?.my) continue;
    runPlanner(room);
    runSpawner(room);
    runLogistics(room);
    runTowers(room);
    drawDefense(room);
    drawCore(room);
    drawZones(room);
  }

  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning) continue;
    const role = roles[creep.memory.type];
    if (!role) {
      console.log(`${creep.name} has unknown type "${creep.memory.type}"`);
      continue;
    }
    // Isolate failures so one misbehaving creep doesn't stop the rest of the tick.
    try {
      if (runRetirement(creep)) continue;
      role.run(creep);
    } catch (err) {
      console.log(`${creep.name} (${creep.memory.type}) error: ${(err as Error).stack ?? err}`);
    }
  }
};
