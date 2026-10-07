import { repeat } from "./parts";

const sets = (n: number) => repeat([WORK, WORK, CARRY, MOVE], n);

/**
 * All-rounder: WORK and CARRY in step, so it can harvest, carry, build and upgrade. Mostly sets
 * of 2W 1C 1M (300 each), plus a tier for RCL 2's full 550: 3W 2C 3M carries twice what the first
 * tier does and, with a MOVE per non-CARRY part, walks faster too (2 ticks per plain tile loaded,
 * 1 empty, against 3 and 2).
 */
export const tiers = [
  sets(1),
  [...repeat([WORK], 3), CARRY, CARRY, ...repeat([MOVE], 3)],
  sets(2),
  sets(3),
  sets(4),
];
