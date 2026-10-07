import { repeat } from "./parts";

/**
 * 5 WORK mines 10 energy/tick, exactly a source's regen rate, and mining is the one task that
 * needs no CARRY: harvested energy drops straight into the container. Fits RCL 2's 550 exactly,
 * and there's never a reason to build a bigger one.
 */
export const tiers = [[...repeat([WORK], 5), MOVE]];
