/** Structures worth sending a creep to repair. Walls and ramparts have huge hit pools; leave them to towers / a dedicated role later. */
export function needsRepair(s: Structure): boolean {
  return s.hits < s.hitsMax * 0.75 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART;
}
