import { setting } from "../utils/settings";
import { type CoreCandidate, coreCandidates } from "./core";
import { planDefense } from "./plan";

/**
 * Console: `defense("sim")` plans the room's defenses (outer ring, tower spots), stores the plan
 * in Memory.defense and summarizes it. Nothing gets built; set showDefense to see it in the room.
 */
export function defenseReport(roomName: string): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const plan = planDefense(room, chosenCore(roomName));
  if (!plan) return `${roomName}: the exits can't be sealed (a source, mineral, spawn or the controller is too close to one)`;
  Memory.defense = { ...Memory.defense, [roomName]: plan };

  const lines = [
    `Defense plan for ${roomName} (tick ${plan.computedAt}):`,
    `  Outer ring: ${plan.ring.length} tiles; ${plan.inside} walkable tiles inside, ${plan.outside} outside`,
    plan.core
      ? `  Tower spots in build order (covering spawn pocket, controller, and the core at ${plan.core.x},${plan.core.y} from RCL 6):`
      : "  Tower spots in build order (covering spawn pocket and controller; run core() first to include a core):",
  ];
  plan.towers.forEach((t, i) => lines.push(`    ${i + 1}. ${t.x},${t.y}  (RCL ${t.rcl})`));
  lines.push(`  Score them per stage with towers("${roomName}").`);
  if (!setting("showDefense")) lines.push("  Set Memory.settings.showDefense = true to draw it.");
  return lines.join("\n");
}

/** Outline colours for the tower targets other than the outer ring (the core's ring has its own overlay). */
const GROUP_COLOUR: Record<string, string> = { "spawn pocket": "#ffee00", controller: "#cc66ff" };

/**
 * Draws the stored plan: outer ring in red, the spawn pocket's entrances, the controller's tiles
 * and custom targets outlined (yellow, purple, cyan), tower spots numbered in blue.
 */
export function drawDefense(room: Room): void {
  const plan = Memory.defense?.[room.name];
  if (!setting("showDefense") || !plan) return;
  for (const [x, y] of plan.ring) {
    room.visual.rect(x - 0.45, y - 0.45, 0.9, 0.9, { fill: "#ff4444", opacity: 0.5 });
  }
  for (const g of plan.groups ?? []) {
    const stroke = g.custom ? "#00e5ff" : GROUP_COLOUR[g.name];
    if (!stroke) continue;
    for (const [x, y] of g.points) room.visual.rect(x - 0.4, y - 0.4, 0.8, 0.8, { fill: "transparent", stroke, strokeWidth: 0.1 });
  }
  plan.towers.forEach((t, i) => {
    room.visual.circle(t.x, t.y, { radius: 0.45, fill: "#4488ff", opacity: 0.7 });
    room.visual.text(String(i + 1), t.x, t.y + 0.2, { color: "#ffffff", font: 0.5 });
  });
}

/** The core site in use: the override if one is set, else the best candidate. */
export function chosenCore(roomName: string): CoreCandidate | undefined {
  const entry = Memory.core?.[roomName];
  if (!entry) return undefined;
  return (entry.pick && entry.candidates[entry.pick - 1]) || entry.candidates[0];
}

/**
 * Console: `core("sim")` finds and scores candidate pockets for the room's core and lists them,
 * best first; the best is used automatically. `core("sim", n)` overrides to candidate n,
 * `core("sim", 0)` goes back to automatic. Set showCore to see them in the room.
 */
export function coreReport(roomName: string, pick?: number): string {
  const room = Game.rooms[roomName];
  if (!room) return `No vision of ${roomName}`;
  const previous = Memory.core?.[roomName];
  const entry =
    pick !== undefined && previous
      ? previous
      : { candidates: coreCandidates(room), pick: previous?.pick, computedAt: Game.time };
  if (pick !== undefined) entry.pick = pick > 0 ? pick : undefined;
  Memory.core = { ...Memory.core, [roomName]: entry };

  const chosen = chosenCore(roomName);
  const lines = [
    `Core candidates for ${roomName} (tick ${entry.computedAt}), ${entry.pick ? `override: #${entry.pick}` : "automatic"}:`,
    "     #  anchor   ring  area  safe  walk  cost",
  ];
  entry.candidates.forEach((c, i) => {
    const mark = c === chosen ? "->" : "  ";
    const pad = (v: unknown, n: number) => String(v).padStart(n);
    lines.push(
      `  ${mark} ${pad(i + 1, 2)}  ${pad(`${c.anchor.x},${c.anchor.y}`, 6)}  ${pad(c.ring.length, 4)}  ${pad(c.area, 4)}` +
        `  ${pad(c.safeArea, 4)}  ${pad(c.logistics, 4)}  ${pad(c.cost, 4)}${c.feasible ? "" : "  (too small)"}`,
    );
  });
  lines.push("  ring: inner-ring tiles; safe: tiles out of ranged reach; walk: steps to sources + controller.");
  if (!setting("showCore")) lines.push("  Set Memory.settings.showCore = true to draw them.");
  return lines.join("\n");
}

/** Draws the chosen pocket's inner ring in orange, and every candidate's anchor numbered by rank. */
export function drawCore(room: Room): void {
  const entry = Memory.core?.[room.name];
  if (!setting("showCore") || !entry) return;
  const chosen = chosenCore(room.name);
  if (chosen) {
    for (const [x, y] of chosen.ring) room.visual.rect(x - 0.45, y - 0.45, 0.9, 0.9, { fill: "#ff9900", opacity: 0.6 });
  }
  entry.candidates.forEach((c, i) => {
    const isChosen = c === chosen;
    room.visual.circle(c.anchor.x, c.anchor.y, { radius: isChosen ? 0.6 : 0.45, fill: isChosen ? "#ff9900" : "#999999", opacity: 0.8 });
    room.visual.text(String(i + 1), c.anchor.x, c.anchor.y + 0.2, { color: "#000000", font: 0.5 });
  });
}
