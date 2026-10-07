/**
 * One-off: converts creeps spawned by earlier versions of this code, which used job roles
 * (harvester, upgrader, builder, miner, hauler) or the static/generalist/specialist types. Safe to delete once
 * those creeps have died out, 1500 ticks after deploy.
 */
function migrate(memory: CreepMemory & { role?: string; sourceId?: Id<Source> }): void {
  const old = memory.role ?? (memory.type as string);
  switch (old) {
    case "miner":
    case "hauler":
      if (memory.role) {
        memory.post = memory.sourceId;
        delete memory.sourceId;
      }
      memory.type = old;
      break;
    case "static":
      // Old static creeps at the controller had 1 CARRY: close enough to a worker.
      if ((memory.post as string) === "controller") {
        memory.type = "worker";
        delete memory.post;
      } else {
        memory.type = "miner";
      }
      // Old bodies don't match the new tiers; mark them outdated so they get replaced.
      delete memory.tier;
      break;
    case "harvester":
    case "upgrader":
    case "builder":
      memory.type = "drone";
      delete memory.tier;
      break;
    case "generalist":
      memory.type = "drone";
      break;
    case "specialist":
      memory.type = "worker";
      break;
  }
  delete memory.role;
}

/** Drops memory for dead creeps and finished construction sites so Memory doesn't grow forever. */
export function cleanMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) delete Memory.creeps[name];
    else migrate(Memory.creeps[name]);
  }
  for (const id in Memory.constructionSites) {
    if (!(id in Game.constructionSites)) delete Memory.constructionSites[id];
  }
}
