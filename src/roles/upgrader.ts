import { collectEnergy, updateWorking } from "../utils/energy";
import { moveSafely } from "../utils/safety";
import type { RoleDef } from "./index";

/** Feeds the room controller to raise RCL and prevent downgrade. */
export const upgrader: RoleDef = {
  run(creep) {
    if (!updateWorking(creep)) {
      collectEnergy(creep);
      return;
    }

    const controller = creep.room.controller;
    if (!controller) return;
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      moveSafely(creep, controller, { visualizePathStyle: { stroke: "#ffffff" } });
    }
  },
};
