// Offline planner harness: runs the room planner on real rooms and renders a contact sheet.
//   npm run plan:rooms [-- ROOM ...]
// Rooms are fetched from the official server's public API (shard0) and cached in tools/rooms/, so
// runs are reproducible offline. A fixture saved from the game's terrain() console helper can be
// dropped in as tools/rooms/<name>.json too.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SHARD = "shard0";
const DEFAULT_ROOMS = ["sim", "W8N3", "W7N4", "W2N5", "E3N7", "E8N2", "W5S3", "E6S8", "W3S7", "W9S2", "E2S4", "W6N8", "E7N6"];

// Game constants the planner uses.
Object.assign(globalThis, {
  TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2,
  FIND_SOURCES: 105, FIND_MINERALS: 116, FIND_MY_SPAWNS: 112, FIND_STRUCTURES: 107,
  STRUCTURE_KEEPER_LAIR: "keeperLair",
  Game: { time: 0, rooms: {} },
  Memory: {},
});

async function loadRoom(name) {
  const file = join(here, "rooms", `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const api = (path) => fetch(`https://screeps.com/api/game/${path}`).then((r) => r.json());
  const terrain = await api(`room-terrain?room=${name}&shard=${SHARD}&encoded=1`);
  const objects = await api(`room-objects?room=${name}&shard=${SHARD}`);
  if (!terrain.ok || !terrain.terrain?.[0]) throw new Error(`no terrain for ${name}`);
  const room = {
    name,
    terrain: terrain.terrain[0].terrain,
    objects: (objects.objects ?? [])
      .filter((o) => ["source", "mineral", "controller", "keeperLair", "spawn"].includes(o.type))
      .map(({ type, x, y }) => ({ type, x, y })),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(room));
  return room;
}

/** A minimal stand-in for a Room, enough for the planner. */
function mockRoom({ name, terrain, objects }) {
  const pos = (o) => ({ x: o.x, y: o.y, roomName: name });
  const of = (type) => objects.filter((o) => o.type === type).map((o) => ({ pos: pos(o), structureType: type }));
  const controller = objects.find((o) => o.type === "controller");
  return {
    name,
    controller: controller && { pos: pos(controller), my: true },
    getTerrain: () => ({ get: (x, y) => Number(terrain[y * 50 + x]) }),
    find: (type) =>
      ({ [FIND_SOURCES]: of("source"), [FIND_MINERALS]: of("mineral"), [FIND_MY_SPAWNS]: of("spawn"), [FIND_STRUCTURES]: of("keeperLair") })[type] ?? [],
  };
}

// --- rendering -------------------------------------------------------------------------------
const TILE = 8;
const ROOM_PX = 50 * TILE;
const GAP = 8;
const HUES = [[230, 25, 75], [60, 180, 75], [255, 225, 25], [67, 99, 216], [245, 130, 49], [145, 30, 180], [70, 240, 240], [240, 50, 230], [188, 246, 12], [250, 190, 190], [0, 128, 128], [230, 190, 255]];
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function drawRoom(pixels, width, ox, oy, room, partition) {
  const set = (x, y, [r, g, b]) => {
    const i = ((oy + y) * width + ox + x) * 3;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
  };
  const labelAt = (x, y) => (x < 0 || x > 49 || y < 0 || y > 49 ? -1 : partition.labels.charCodeAt(x * 50 + y) - 65);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const t = Number(room.terrain[y * 50 + x]);
      const z = labelAt(x, y);
      let colour = t & 1 ? [25, 25, 25] : t & 2 ? [70, 90, 50] : [120, 120, 120];
      if (z >= 0) {
        const hue = HUES[z % HUES.length];
        colour = colour.map((c, k) => Math.round(c * 0.55 + hue[k] * 0.45));
      }
      for (let px = 0; px < TILE; px++) {
        for (let py = 0; py < TILE; py++) {
          // Darken tile edges that border another zone, so boundaries read clearly.
          const edge =
            z >= 0 &&
            ((px === 0 && labelAt(x - 1, y) >= 0 && labelAt(x - 1, y) !== z) || (py === 0 && labelAt(x, y - 1) >= 0 && labelAt(x, y - 1) !== z));
          set(x * TILE + px, y * TILE + py, edge ? [0, 0, 0] : colour);
        }
      }
    }
  }
  const marker = { source: [255, 230, 0], controller: [200, 80, 255], mineral: [0, 220, 255], spawn: [255, 255, 255], keeperLair: [255, 0, 0] };
  for (const o of room.objects) {
    for (let px = 1; px < TILE - 1; px++) for (let py = 1; py < TILE - 1; py++) set(o.x * TILE + px, o.y * TILE + py, marker[o.type] ?? [255, 255, 255]);
  }
  // Development order at each zone's peak, as a 3x5 digit drawn at 2x.
  for (const z of partition.zones) {
    const text = z.order ? String(z.order) : "";
    [...text].forEach((d, i) => {
      const glyph = DIGITS[Number(d)];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (glyph[gy * 3 + gx] !== "1") continue;
          for (let s = 0; s < 4; s++) set(z.peak.x * TILE + i * 8 + gx * 2 + (s & 1), z.peak.y * TILE + gy * 2 + (s >> 1), [255, 255, 255]);
        }
      }
    });
  }
}

const { partitionRoom } = require("./out/plan/zones.js");
const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOMS;
const results = [];
for (const name of names) {
  let room;
  try {
    room = await loadRoom(name);
  } catch (e) {
    console.log(`${name}: skipped (${e.message})`);
    continue;
  }
  if (!room.objects.some((o) => o.type === "controller")) {
    console.log(`${name}: skipped (no controller)`);
    continue;
  }
  const partition = partitionRoom(mockRoom(room));
  results.push({ room, partition });
  const developed = partition.zones.filter((z) => z.order).sort((a, b) => a.order - b.order);
  console.log(`${name}: ${partition.zones.length} zones; development order: ` +
    developed.map((z) => `${z.order}:(${z.peak.x},${z.peak.y}) a${z.area} d${z.defensibility.toFixed(1)}`).join("  "));
}

const cols = Math.min(4, results.length);
const rows = Math.ceil(results.length / cols);
const width = cols * ROOM_PX + (cols - 1) * GAP;
const height = rows * ROOM_PX + (rows - 1) * GAP;
const pixels = new Uint8Array(width * height * 3).fill(255);
results.forEach(({ room, partition }, i) => drawRoom(pixels, width, (i % cols) * (ROOM_PX + GAP), Math.floor(i / cols) * (ROOM_PX + GAP), room, partition));
const out = join(here, "out", "zones.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(width, height, pixels));
console.log(`\nRooms (left to right, top to bottom): ${results.map((r) => r.room.name).join(", ")}`);
console.log(`Wrote ${out}`);
