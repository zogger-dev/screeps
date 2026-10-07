import { bestTier, tierBody } from "../bodies";
import { assignRoutes, dronesWanted, isRouteValid, type Assignment } from "../logistics/assign";
import { buildNetwork } from "../logistics/network";
import { homeCreeps } from "../utils/census";
import { setting } from "../utils/settings";

/** Re-plan at least this often, to follow changing demand (refills, new sites, finished work). */
const REPLAN_INTERVAL = 50;

const lastPlan = new Map<string, number>();
const wanted = new Map<string, number>();
const lastAssignments = new Map<string, Map<string, Assignment>>();

/** Drones the room's logistics plan can use, as of the last plan. The spawner sizes drones by this. */
export function wantedDrones(roomName: string): number | undefined {
  return wanted.get(roomName);
}

/** Lines from each supply to each sink in use, labelled with how many drones run that route. */
function drawRoutes(room: Room, assignments: Map<string, Assignment>): void {
  const counts = new Map<string, { a: Assignment; n: number }>();
  for (const a of assignments.values()) {
    const key = `${a.supply.id}>${a.sink.key}`;
    counts.set(key, { a, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  for (const { a, n } of counts.values()) {
    const from = a.supply.pos;
    const to = a.sink.pos;
    room.visual.line(from, to, { color: "#66ccff", opacity: 0.5, lineStyle: "dashed" });
    room.visual.text(`${n} ${a.sink.kind}`, (from.x + to.x) / 2, (from.y + to.y) / 2, {
      color: "#66ccff",
      font: 0.5,
    });
  }
}

/**
 * Plans the room's drone routes (see logistics/). Re-plans every REPLAN_INTERVAL ticks, and
 * straight away whenever a drone has no valid route: a new drone, or its site was finished.
 * Drones the plan has no use for are retired, never going below minDrones.
 */
export function runLogistics(room: Room): void {
  const drones = homeCreeps(room.name).filter(
    (c) => c.memory.type === "drone" && !c.spawning && !c.memory.retiring,
  );
  const due = Game.time - (lastPlan.get(room.name) ?? -Infinity) >= REPLAN_INTERVAL;
  if (due || !drones.every((d) => isRouteValid(d.memory.route))) {
    const network = buildNetwork(room);
    const assignments = assignRoutes(drones, network);
    const body = tierBody("drone", Math.max(0, bestTier("drone", room.energyCapacityAvailable)));
    wanted.set(room.name, dronesWanted(network, body, setting("maxDrones")));
    lastAssignments.set(room.name, assignments);
    lastPlan.set(room.name, Game.time);

    // Surplus: no route means no supply left for it. Recycle it rather than let it crowd sources.
    let spare = drones.length - setting("minDrones");
    for (const drone of drones) {
      if (spare <= 0) break;
      if (!assignments.has(drone.name)) {
        drone.memory.retiring = true;
        spare--;
      }
    }
  }

  const assignments = lastAssignments.get(room.name);
  if (setting("showRoutes") && assignments) drawRoutes(room, assignments);
}
