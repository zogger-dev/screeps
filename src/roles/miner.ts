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
    if (container && !creep.pos.isEqualTo(container.pos)) {
      moveSafely(creep, container, { range: 0, visualizePathStyle: { stroke: "#ffaa00" } });
    } else if (!container && !creep.pos.isNearTo(source)) {
      moveSafely(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    // Harvest whenever in range, even while still stepping onto the container.
    creep.harvest(source);
  },
};
