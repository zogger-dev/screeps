import { isWall } from "../utils/terrain";
import { tile } from "./grid";
import { planDefense } from "./plan";
import { CORE_RCL, exposureMap, range, stageOf, STAGES, targetGroups, towerDamage } from "./towers";

/** The walkable tile nearest (x, y), since a sketched layout may land on rock. */
function snap(terrain: RoomTerrain, x: number, y: number): [number, number] {
  for (let r = 0; r < 50; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && nx > 0 && nx < 49 && ny > 0 && ny < 49 && !isWall(terrain, nx, ny)) {
          return [nx, ny];
        }
      }
    }
  }
  return [x, y];
}

/**
 * Console: `towers("sim")` scores the planned tower layout; `towers("sim", [[x, y], ...])` scores
 * any layout, in build order (points on rock snap to the nearest walkable tile). For each stage
 * (1, 2, 3, 6 towers) and each target group active by then: the average and weakest total damage
 * over its entrance tiles. Plus each tower's exposure when built: tiles an attacker could shoot it
 * from with the outer ring breached (and, from RCL 6, the core walled).
 */
export function towerReport(roomName: string, layout?: [number, number][]): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const terrain = room.getTerrain();
  const towers = layout
    ? layout.map(([x, y]) => snap(terrain, x, y))
    : (Memory.defense?.[roomName]?.towers ?? []).map((t): [number, number] => [t.x, t.y]);
  if (towers.length === 0) return `No layout given and no plan stored; run defense("${roomName}") or pass one.`;

  const core = Memory.core?.[roomName];
  const chosen = core && ((core.pick && core.candidates[core.pick - 1]) || core.candidates[0]);
  const outer = Memory.defense?.[roomName]?.ring ?? planDefense(room, chosen)?.ring ?? [];
  const groups = targetGroups(room, outer, chosen);
  const open = exposureMap(room);
  const sheltered = chosen ? exposureMap(room, chosen) : open;
  const lines = [`Tower layout for ${roomName}: ${towers.map(([x, y], i) => `T${i + 1} ${x},${y}`).join("  ")}`];
  lines.push(`  ${"stage".padEnd(11)}${groups.map((g) => g.name.slice(0, 21).padEnd(22)).join("")}`);
  for (const stage of STAGES) {
    const built = towers.slice(0, stage.towers);
    const cells = groups.map((g) => {
      if (stage.rcl < g.fromRcl || g.points.length === 0) return "-".padEnd(22);
      const damage = g.points.map(([px, py]) => built.reduce((s, [tx, ty]) => s + towerDamage(range(tx, ty, px, py)), 0));
      const average = damage.reduce((a, b) => a + b, 0) / damage.length;
      return `avg ${Math.round(average)}, min ${Math.round(Math.min(...damage))}`.padEnd(22);
    });
    lines.push(`  ${`RCL ${stage.rcl} (${stage.towers})`.padEnd(11)}${cells.join("")}`);
  }
  // Exposure at the level each tower is built: the core only shelters towers once it's walled.
  const exposure = (k: number, x: number, y: number) => (stageOf(k) >= CORE_RCL ? sheltered : open)[tile(x, y)];
  lines.push(`  exposure: ${towers.map(([x, y], i) => `T${i + 1} ${exposure(i, x, y)}`).join("  ")} tiles in reach when built`);
  lines.push("  avg / min: average and weakest total damage per tick over each group's entrance tiles (max 3600 with 6 towers).");
  return lines.join("\n");
}
