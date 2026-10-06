import { builder } from "./builder";
import { harvester } from "./harvester";
import { upgrader } from "./upgrader";

export interface RoleDef {
  run(creep: Creep): void;
}

export const roles: Record<Role, RoleDef> = { harvester, upgrader, builder };
