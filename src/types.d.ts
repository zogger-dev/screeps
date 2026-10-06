type Role = "harvester" | "upgrader" | "builder";

interface CreepMemory {
  role: Role;
  /** Room this creep belongs to (where it was spawned). */
  room: string;
  /** true while spending energy, false while gathering it. */
  working: boolean;
  sourceId?: Id<Source>;
}

interface Memory {
  /** Per-site overrides, keyed by construction site id. See utils/construction.ts. */
  constructionSites?: Record<string, { priority: number }>;
}

/** Screeps only provides console.log (output appears in the in-game console). */
declare const console: { log(...args: unknown[]): void };
