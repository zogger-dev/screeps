import { runPlanner } from "./managers/planner";
import { runRetirement } from "./managers/retirement";
import { runSpawner } from "./managers/spawner";
import { runTowers } from "./managers/towers";
import { roles } from "./roles";
import { cleanMemory } from "./utils/memory";

export const loop = (): void => {
  cleanMemory();

  for (const room of Object.values(Game.rooms)) {
    if (!room.controller?.my) continue;
    runPlanner(room);
    runSpawner(room);
    runTowers(room);
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
