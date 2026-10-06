import { pickSite } from "../utils/construction";
import { collectEnergy, updateWorking } from "../utils/energy";
import { needsRepair } from "../utils/repair";
import { isSafe, moveSafely } from "../utils/safety";
import type { RoleDef } from "./index";
import { upgrader } from "./upgrader";

/** Builds construction sites in priority order, then repairs, then falls back to upgrading. */
export const builder: RoleDef = {
  run(creep) {
    if (!updateWorking(creep)) {
      collectEnergy(creep);
      return;
    }

    const site = pickSite(creep, creep.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => isSafe(s.pos) }));
    if (site) {
      if (creep.build(site) === ERR_NOT_IN_RANGE) {
        moveSafely(creep, site, { visualizePathStyle: { stroke: "#ffffff" } });
      }
      return;
    }

    const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => needsRepair(s) && isSafe(s.pos),
    });
    if (damaged) {
      if (creep.repair(damaged) === ERR_NOT_IN_RANGE) {
        moveSafely(creep, damaged, { visualizePathStyle: { stroke: "#00ff00" } });
      }
      return;
    }

    upgrader.run(creep);
  },
};
