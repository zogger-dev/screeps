import { repeat } from "./parts";

/** One MOVE per CARRY keeps a full hauler at full speed off-road. 100 per pair. */
export const tiers = [2, 3, 5, 8, 12, 16].map((n) => repeat([CARRY, MOVE], n));
