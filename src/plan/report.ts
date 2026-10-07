import { setting } from "../utils/settings";
import { partitionRoom } from "./zones";

/** Distinct hues for zone tints, cycled by zone id. */
const HUES = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff"];

/**
 * Console: `zones("sim")` partitions the room into zones, stores the result in Memory.zones and
 * lists them in development order. Set showZones to tint them in the room.
 */
export function zonesReport(roomName: string): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const partition = partitionRoom(room);
  Memory.zones = { ...Memory.zones, [roomName]: partition };

  const lines = [`Zones for ${roomName} (tick ${partition.computedAt}), in development order:`, "  order  zone  peak    area  perim  def   src  ctrl  spawn  dist  score"];
  const pad = (v: unknown, n: number) => String(v).padStart(n);
  const sorted = [...partition.zones].sort((a, b) => (a.order || 99) - (b.order || 99));
  for (const z of sorted) {
    lines.push(
      `  ${pad(z.order || "-", 5)}  ${pad(z.id, 4)}  ${pad(`${z.peak.x},${z.peak.y}`, 6)}  ${pad(z.area, 4)}  ${pad(z.perimeter, 5)}` +
        `  ${pad(z.defensibility.toFixed(1), 4)}  ${pad(z.sources, 3)}  ${pad(z.controller ? "yes" : "", 4)}  ${pad(z.spawn ? "yes" : "", 5)}` +
        `  ${pad(z.distance, 4)}  ${pad(z.score, 5)}`,
    );
  }
  lines.push("  def: area per perimeter tile (higher is easier to defend); '-' order: left open, not needed for the base.");
  if (!setting("showZones")) lines.push("  Set Memory.settings.showZones = true to draw them.");
  return lines.join("\n");
}

/** Tints each zone and labels its peak with its development order. */
export function drawZones(room: Room): void {
  const partition = Memory.zones?.[room.name];
  if (!setting("showZones") || !partition) return;
  for (let t = 0; t < 2500; t++) {
    const c = partition.labels.charCodeAt(t) - 65;
    if (c < 0) continue;
    room.visual.rect(Math.floor(t / 50) - 0.5, (t % 50) - 0.5, 1, 1, { fill: HUES[c % HUES.length], opacity: 0.15 });
  }
  for (const z of partition.zones) {
    room.visual.text(z.order ? String(z.order) : "-", z.peak.x, z.peak.y + 0.35, { color: "#ffffff", font: 1, stroke: "#000000" });
  }
}

/**
 * Console: `terrain("sim")` prints the room's terrain as 2500 digits, row by row (index y * 50 + x;
 * 0 plain, 1 wall, 2 swamp), the same encoding as the server's room-terrain API, so it can be used
 * as an offline test fixture.
 */
export function terrainExport(roomName: string): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const terrain = room.getTerrain();
  let s = "";
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) s += String(terrain.get(x, y));
  const objects = [
    ...room.find(FIND_SOURCES).map((o) => `source ${o.pos.x},${o.pos.y}`),
    ...room.find(FIND_MINERALS).map((o) => `mineral ${o.pos.x},${o.pos.y}`),
    ...room.find(FIND_MY_SPAWNS).map((o) => `spawn ${o.pos.x},${o.pos.y}`),
    ...room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_KEEPER_LAIR }).map((o) => `lair ${o.pos.x},${o.pos.y}`),
  ];
  if (room.controller) objects.push(`controller ${room.controller.pos.x},${room.controller.pos.y}`);
  return `${s}\n${objects.join("; ")}`;
}
