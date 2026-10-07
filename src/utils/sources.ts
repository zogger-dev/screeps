/** The container next to a source, where a static miner sits. */
export function sourceContainer(source: Source): StructureContainer | undefined {
  return source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
  })[0];
}

export function isSourceContainer(s: Structure): boolean {
  return s.structureType === STRUCTURE_CONTAINER && s.pos.findInRange(FIND_SOURCES, 1).length > 0;
}

/** The container within upgrade range of the controller, where static upgraders work. */
export function controllerContainer(room: Room): StructureContainer | undefined {
  return room.controller?.pos.findInRange(FIND_STRUCTURES, 3, {
    filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER && !isSourceContainer(s),
  })[0];
}
