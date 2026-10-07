import { moveSafely } from "../utils/safety";
import { sourceContainer } from "../utils/sources";
import type { RoleDef } from "./index";

/**
 * Sits on its source's container and mines nonstop. With no CARRY, harvested energy drops
 * straight into the container below, or onto the ground if it's full or missing.
 */
export const miner: RoleDef = {
  run(creep) {
    const source = creep.memory.post && Game.getObjectById(creep.memory.post);
    if (!source) return;

    const container = sourceContainer(source);
    // The container tile can be taken, e.g. by the miner this one is replacing: mine from any
    // tile next to the source until it's free.
    const taken = container?.pos.lookFor(LOOK_CREEPS).some((c) => c !== creep);
    if (container && !taken && !creep.pos.isEqualTo(container.pos)) {
      moveSafely(creep, container, { range: 0, visualizePathStyle: { stroke: "#ffaa00" } });
    } else if (!creep.pos.isNearTo(source)) {
      moveSafely(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    // Harvest whenever in range, even while still stepping onto the container.
    creep.harvest(source);
  },
};
