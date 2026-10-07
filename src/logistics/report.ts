import { homeCreeps } from "../utils/census";
import { buildNetwork } from "./network";

const fmt = (n: number) => (isFinite(n) ? n.toFixed(2) : "inf");

/**
 * Console diagnostic: `logistics("sim")` prints the room's supplies, sinks and how many drones
 * are on each route, so the plan can be checked without screenshots.
 */
export function logisticsReport(roomName: string): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const { supplies, sinks } = buildNetwork(room);
  const drones = homeCreeps(roomName).filter((c) => c.memory.type === "drone");

  const lines = [`Logistics for ${roomName} at tick ${Game.time}`, "Supplies (id kind pos rate/tick spots):"];
  for (const s of supplies) lines.push(`  ${s.id} ${s.kind} ${s.pos.x},${s.pos.y} ${fmt(s.rate)} ${s.spots}`);
  lines.push("Sinks (key priority pos demand/tick):");
  for (const k of [...sinks].sort((a, b) => a.priority - b.priority)) {
    lines.push(`  ${k.key} p${k.priority} ${k.pos.x},${k.pos.y} ${fmt(k.demand)}`);
  }
  const routes = new Map<string, number>();
  for (const d of drones) {
    const r = d.memory.route;
    const key = r ? `${r.from} -> ${r.kind}${r.target ? `:${r.target}` : ""}` : "(no route)";
    routes.set(key, (routes.get(key) ?? 0) + 1);
  }
  lines.push(`Drones (${drones.length}):`);
  for (const [key, n] of [...routes].sort()) lines.push(`  ${n} x ${key}`);
  return lines.join("\n");
}
