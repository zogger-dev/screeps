import { repeat } from "./parts";

/** All-rounder: WORK and CARRY in step, so it can harvest, carry, build and upgrade. 300 per set. */
export const tiers = [1, 2, 3, 4].map((n) => repeat([WORK, WORK, CARRY, MOVE], n));
