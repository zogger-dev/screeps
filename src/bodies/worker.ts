import { repeat } from "./parts";

/**
 * Upgrading has no per-creep cap, so more WORK means fewer creeps. They refill from the
 * container in the same tick they upgrade, so one CARRY is enough; if the container keeps running
 * dry, add haulers rather than buffer. Spare energy goes to MOVE, which shortens the walk out
 * (they leave empty, so only WORK adds fatigue). Starts at RCL 3 (800 exactly).
 */
export const tiers = [
  [...repeat([WORK], 6), CARRY, ...repeat([MOVE], 3)],
  [...repeat([WORK], 10), CARRY, ...repeat([MOVE], 3)],
  [...repeat([WORK], 15), CARRY, CARRY, ...repeat([MOVE], 4)],
];
