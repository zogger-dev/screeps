import { isTrappedKeeper } from "../utils/lairs";

/**
 * Towers shoot the closest hostile, otherwise heal injured friendly creeps. Keepers trapped on a
 * walled-in lair are left alone: they can't reach anything we path near, and damaging one only
 * makes the lair replace it with a fresh keeper.
 */
export function runTowers(room: Room): void {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER,
  });
  for (const tower of towers) {
    const hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, { filter: (c) => !isTrappedKeeper(c) });
    if (hostile) {
      tower.attack(hostile);
      continue;
    }
    const injured = tower.pos.findClosestByRange(FIND_MY_CREEPS, { filter: (c) => c.hits < c.hitsMax });
    if (injured) tower.heal(injured);
  }
}
