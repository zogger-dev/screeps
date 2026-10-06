import { needsRepair } from "../utils/repair";
import { safeSources } from "../utils/safety";
import { harvestSpots } from "../utils/sources";

/**
 * Spawn queue as cumulative [role, count] steps, evaluated in order: the first step whose role is
 * below its count gets spawned. Every role gets a minimum before any role is filled out, so a large
 * harvester target can't starve the others.
 */
function plan(room: Room): [Role, number][] {
  // Sources guarded by keepers or hostiles don't count; harvesters sent there just die.
  const sources = safeSources(room);
  // One harvester per open tile around each source.
  const harvesters = sources.reduce((sum, s) => sum + harvestSpots(s), 0);
  const hasSites = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
  const hasRepairs = room.find(FIND_STRUCTURES, { filter: needsRepair }).length > 0;
  const builders = hasSites ? 2 : hasRepairs ? 1 : 0;
  return [
    ["harvester", sources.length],
    ["upgrader", 1],
    ["builder", Math.min(builders, 1)],
    ["harvester", harvesters],
    ["upgrader", 2],
    ["builder", builders],
  ];
}

const BODY_SET = [WORK, CARRY, MOVE];
const BODY_SET_COST = 200;
const MAX_SETS = 5;

/** Repeats [WORK, CARRY, MOVE] as many times as the energy budget allows. */
function buildBody(energy: number): BodyPartConstant[] {
  const sets = Math.min(MAX_SETS, Math.floor(energy / BODY_SET_COST));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...BODY_SET);
  return body;
}

/** Labels busy spawns with the role they're producing. */
function drawSpawning(spawns: StructureSpawn[]): void {
  for (const spawn of spawns) {
    if (!spawn.spawning) continue;
    const role = Memory.creeps[spawn.spawning.name]?.role;
    spawn.room.visual.text(`🛠️ ${role}`, spawn.pos.x + 1, spawn.pos.y, { align: "left", opacity: 0.8 });
  }
}

export function runSpawner(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS);
  drawSpawning(spawns);

  const spawn = spawns.find((s) => !s.spawning);
  if (!spawn) return;

  const counts: Partial<Record<Role, number>> = {};
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.room !== room.name) continue;
    counts[creep.memory.role] = (counts[creep.memory.role] ?? 0) + 1;
  }

  for (const [role, wanted] of plan(room)) {
    if ((counts[role] ?? 0) >= wanted) continue;

    // With no harvesters the economy is dead, so spawn whatever we can afford right now
    // rather than waiting for full extensions that will never fill.
    const recovering = role === "harvester" && !counts.harvester;
    const budget = recovering ? room.energyAvailable : room.energyCapacityAvailable;
    const body = buildBody(budget);
    if (body.length === 0) return;

    spawn.spawnCreep(body, `${role}-${Game.time}`, {
      memory: { role, room: room.name, working: false },
    });
    // Whether it spawned or is waiting on energy, don't let lower-priority roles jump the queue.
    return;
  }
}
