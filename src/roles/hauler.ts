import { deliverEnergy, findLooseEnergy, takeEnergy, updateWorking } from "../utils/energy";
import { moveSafely } from "../utils/safety";
import { sourceContainer } from "../utils/sources";
import type { RoleDef } from "./index";

/**
 * Carries energy to where it's needed: decaying energy anywhere in the room first, then its
 * source's container.
 */
export const hauler: RoleDef = {
  run(creep) {
    if (updateWorking(creep)) {
      deliverEnergy(creep);
      return;
    }

    const loose = findLooseEnergy(creep);
    if (loose) {
      takeEnergy(creep, loose);
      return;
    }

    const source = creep.memory.post && Game.getObjectById(creep.memory.post);
    if (!source) return;

    // Small overflow piles at our own source are on the way, so take them even under the
    // room-wide minimum.
    const overflow = source.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY,
    })[0];
    if (overflow) {
      takeEnergy(creep, overflow);
      return;
    }

    const container = sourceContainer(source);
    if (container && container.store[RESOURCE_ENERGY] > 0) {
      takeEnergy(creep, container);
      return;
    }

    // Wait nearby without blocking the miner's spot.
    if (!creep.pos.inRangeTo(source, 2)) moveSafely(creep, source, { range: 2 });
  },
};
