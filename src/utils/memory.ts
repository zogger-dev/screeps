/** Drops memory for dead creeps and finished construction sites so Memory doesn't grow forever. */
export function cleanMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) delete Memory.creeps[name];
  }
  for (const id in Memory.constructionSites) {
    if (!(id in Game.constructionSites)) delete Memory.constructionSites[id];
  }
}
