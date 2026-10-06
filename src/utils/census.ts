let cacheTick = -1;
const byRoom = new Map<string, Creep[]>();

/** Creeps whose home is `roomName` (including ones still spawning). Cached per tick. */
export function homeCreeps(roomName: string): Creep[] {
  if (cacheTick !== Game.time) {
    byRoom.clear();
    for (const creep of Object.values(Game.creeps)) {
      const list = byRoom.get(creep.memory.room) ?? [];
      list.push(creep);
      byRoom.set(creep.memory.room, list);
    }
    cacheTick = Game.time;
  }
  return byRoom.get(roomName) ?? [];
}
