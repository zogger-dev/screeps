import { bestTier, isOutdated, tierBody } from "../utils/body";
import { homeCreeps } from "../utils/census";
import { haulersNeeded, isStaticSource, sourceIncome } from "../utils/mining";
import { needsRepair } from "../utils/repair";
import { safeSources } from "../utils/safety";
import { setting } from "../utils/settings";
import { controllerContainer, harvestSpots } from "../utils/sources";

interface Step {
  type: CreepType;
  count: number;
  /** For miners and haulers: which source this step is for. */
  post?: Post;
}

/** Tiles next to the controller container that are also within upgrade range of the controller. */
function upgradeSpots(controller: StructureController, container: StructureContainer): number {
  const terrain = controller.room.getTerrain();
  let spots = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = container.pos.x + dx;
      const y = container.pos.y + dy;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL && controller.pos.getRangeTo(x, y) <= 3) spots++;
    }
  }
  return spots;
}

/**
 * Enough workers to spend the upgradeShare of static income, capped by standing room.
 * Zero until the room can afford the first worker tier (RCL 3).
 */
function workers(room: Room, staticSources: Source[], container: StructureContainer): number {
  const tier = bestTier("worker", room.energyCapacityAvailable);
  if (tier < 0) return 0;
  const income = staticSources.reduce((sum, s) => sum + sourceIncome(s), 0);
  const work = tierBody("worker", tier).filter((p) => p === WORK).length * UPGRADE_CONTROLLER_POWER;
  const wanted = Math.max(1, Math.floor((income * setting("upgradeShare")) / work));
  return Math.min(wanted, upgradeSpots(room.controller!, container));
}

/**
 * Spawn queue as cumulative steps, evaluated in order: the first step below its count gets
 * spawned. Every post gets a minimum before any is filled out, so a large target can't starve
 * the others.
 */
function plan(room: Room): Step[] {
  // Sources guarded by keepers or hostiles don't count; creeps sent there just die.
  const sources = safeSources(room);
  const staticSources = sources.filter(isStaticSource);
  const harvestSources = sources.filter((s) => !isStaticSource(s));

  // Workers need haulers to fill their container, which only exist with static sources.
  const container = controllerContainer(room);
  const upgraders = container && staticSources.length > 0 ? workers(room, staticSources, container) : 0;

  // Drones: one per open tile at sources they still harvest, plus builders while there are
  // sites, plus one to upgrade until workers take over; never fewer than minDrones.
  const harvesting = harvestSources.reduce((sum, s) => sum + harvestSpots(s), 0);
  const hasSites = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
  const hasRepairs = room.find(FIND_STRUCTURES, { filter: needsRepair }).length > 0;
  const projects = hasSites ? setting("builders") : hasRepairs ? 1 : 0;
  const drones = Math.max(setting("minDrones"), harvesting + projects + (upgraders > 0 ? 0 : 1));

  const steps: Step[] = [];
  for (const s of staticSources) {
    steps.push({ type: "miner", count: 1, post: s.id }, { type: "hauler", count: 1, post: s.id });
  }
  steps.push({ type: "drone", count: Math.max(1, harvestSources.length) });
  if (upgraders > 0) steps.push({ type: "worker", count: 1 });
  for (const s of staticSources) steps.push({ type: "hauler", count: haulersNeeded(s), post: s.id });
  steps.push({ type: "drone", count: drones });
  if (upgraders > 0) steps.push({ type: "worker", count: upgraders });
  return steps;
}

const matches = (creep: Creep, step: Step) =>
  creep.memory.type === step.type && (step.post === undefined || creep.memory.post === step.post);

/**
 * Creeps that count towards a step. Outdated creeps don't, so the spawner builds bigger
 * replacements while the old ones keep working.
 */
function current(room: Room, creeps: Creep[], step: Step): Creep[] {
  return creeps.filter((c) => matches(c, step) && !c.memory.retiring && !isOutdated(c, room));
}

/**
 * Once up-to-date creeps cover a post's full target, retire the outdated ones they replaced.
 * Posts appear in several steps with growing counts, so only the largest count per post
 * matters here; otherwise meeting an early minimum would retire creeps we still need.
 */
function retireReplaced(room: Room, creeps: Creep[], steps: Step[]): void {
  const targets = new Map<string, Step>();
  for (const step of steps) {
    const key = `${step.type}:${step.post ?? ""}`;
    if (step.count >= (targets.get(key)?.count ?? 0)) targets.set(key, step);
  }
  for (const step of targets.values()) {
    if (current(room, creeps, step).length < step.count) continue;
    for (const creep of creeps) {
      if (matches(creep, step) && !creep.memory.retiring && isOutdated(creep, room)) creep.memory.retiring = true;
    }
  }
}

function spawn(spawner: StructureSpawn, type: CreepType, tier: number, post?: Post): void {
  spawner.spawnCreep(tierBody(type, tier), `${type}-${Game.time}`, {
    memory: { type, room: spawner.room.name, working: false, tier, post },
  });
}

/**
 * If nothing is bringing energy home, spawn whatever we can afford right now rather than waiting
 * for full extensions that will never fill. Returns true if the economy needed rescuing.
 */
function recover(room: Room, creeps: Creep[], spawner: StructureSpawn): boolean {
  const miner = creeps.find((c) => c.memory.type === "miner");
  const hasHauler = creeps.some((c) => c.memory.type === "hauler");
  if (creeps.some((c) => c.memory.type === "drone") || (miner && hasHauler)) return false;

  // A lone miner just needs someone to carry its energy; otherwise start from scratch.
  const type: CreepType = miner ? "hauler" : "drone";
  const tier = bestTier(type, room.energyAvailable);
  if (tier >= 0) spawn(spawner, type, tier, miner?.memory.post);
  return true;
}

/** Labels busy spawns with the type they're producing. */
function drawSpawning(spawns: StructureSpawn[]): void {
  for (const s of spawns) {
    if (!s.spawning) continue;
    const type = Memory.creeps[s.spawning.name]?.type;
    s.room.visual.text(`🛠️ ${type}`, s.pos.x + 1, s.pos.y, { align: "left", opacity: 0.8 });
  }
}

export function runSpawner(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS);
  drawSpawning(spawns);

  const creeps = homeCreeps(room.name);
  const steps = plan(room);
  retireReplaced(room, creeps, steps);

  const idle = spawns.find((s) => !s.spawning);
  if (!idle || recover(room, creeps, idle)) return;

  for (const step of steps) {
    if (current(room, creeps, step).length >= step.count) continue;
    const tier = bestTier(step.type, room.energyCapacityAvailable);
    if (tier >= 0) spawn(idle, step.type, tier, step.post);
    // Whether it spawned or is waiting on energy, don't let lower-priority steps jump the queue.
    return;
  }
}
