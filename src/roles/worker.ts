import { moveSafely } from "../utils/safety";
import { controllerContainer } from "../utils/sources";
import type { RoleDef } from "./index";

/**
 * Stands next to the controller container and upgrades nonstop. Upgrading spends carried
 * energy, 1 per WORK part per tick, so it tops up from the container before running dry;
 * withdrawing and upgrading can happen in the same tick.
 */
export const worker: RoleDef = {
  run(creep) {
    const controller = creep.room.controller;
    const container = controllerContainer(creep.room);
    if (!controller || !container) return;

    if (!creep.pos.inRangeTo(container, 1) || !creep.pos.inRangeTo(controller, 3)) {
      moveSafely(creep, container, { range: 1, visualizePathStyle: { stroke: "#ffffff" } });
    }
    if (creep.store[RESOURCE_ENERGY] <= creep.getActiveBodyparts(WORK)) creep.withdraw(container, RESOURCE_ENERGY);
    creep.upgradeController(controller);
  },
};
