function repeat(parts: BodyPartConstant[], times: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < times; i++) body.push(...parts);
  return body;
}

const work = (n: number) => repeat([WORK], n);

/** Body tiers per creep type, smallest first. A creep's tier is its index in its type's list. */
const TIERS: Record<CreepType, BodyPartConstant[][]> = {
  drone: [1, 2, 3, 4].map((n) => repeat([WORK, WORK, CARRY, MOVE], n)),
  // 5 WORK mines 10 energy/tick, exactly a source's regen rate, and mining is the one task that
  // needs no CARRY: harvested energy drops straight into the container. Fits RCL 2's 550 exactly,
  // and there's never a reason to build a bigger one.
  miner: [[...work(5), MOVE]],
  // Upgrading has no per-creep cap, so more WORK means fewer creeps. They refill from the
  // container in the same tick they upgrade, so one CARRY is enough; if the container keeps running
  // dry, add haulers rather than buffer. Spare energy goes to MOVE, which shortens the walk out
  // (they leave empty, so only WORK adds fatigue). Starts at RCL 3 (800 exactly).
  worker: [
    [...work(6), CARRY, MOVE, MOVE, MOVE],
    [...work(10), CARRY, MOVE, MOVE, MOVE],
    [...work(15), CARRY, CARRY, ...repeat([MOVE], 4)],
  ],
  hauler: [2, 3, 5, 8, 12, 16].map((n) => repeat([CARRY, MOVE], n)),
};

export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

/** Index of the biggest tier affordable with `energy`, or -1 if none is. */
export function bestTier(type: CreepType, energy: number): number {
  const tiers = TIERS[type];
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (bodyCost(tiers[i]) <= energy) return i;
  }
  return -1;
}

export function tierBody(type: CreepType, tier: number): BodyPartConstant[] {
  return TIERS[type][tier];
}

/** True if the creep is smaller than what its home room could spawn today. */
export function isOutdated(creep: Creep, room: Room): boolean {
  return (creep.memory.tier ?? -1) < bestTier(creep.memory.type, room.energyCapacityAvailable);
}
