import { tiers as drone } from "./drone";
import { tiers as hauler } from "./hauler";
import { tiers as miner } from "./miner";
import { tiers as worker } from "./worker";

/**
 * Body tiers per creep type, smallest first; each type's tiers and reasoning live in its own
 * file. A creep's tier is its index in its type's list.
 */
const TIERS: Record<CreepType, BodyPartConstant[][]> = { drone, miner, worker, hauler };

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
