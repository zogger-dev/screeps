import { drone } from "./drone";
import { hauler } from "./hauler";
import { miner } from "./miner";
import { worker } from "./worker";

export interface RoleDef {
  run(creep: Creep): void;
}

export const roles: Record<CreepType, RoleDef> = { drone, miner, worker, hauler };
