import type { Leg } from "./paths";

/**
 * Ticks to cross one tile: each non-MOVE part adds 2 x factor fatigue per step (CARRY only when
 * loaded; factor is road 0.5, plain 1, swamp 5) and each MOVE part removes 2 per tick.
 */
export function ticksPerTile(weight: number, move: number, factor: number): number {
  if (weight === 0) return 1;
  if (move === 0) return Infinity;
  return Math.max(1, Math.ceil((weight * factor) / move));
}

/** Ticks for a creep to walk a leg, loaded (its CARRY parts weigh) or empty. */
export function walkTicks(creep: Creep, leg: Leg, loaded: boolean): number {
  const weight = creep.body.filter((p) => p.hits > 0 && p.type !== MOVE && (loaded || p.type !== CARRY)).length;
  const move = creep.getActiveBodyparts(MOVE);
  return leg.tiles.reduce((sum, t) => sum + ticksPerTile(weight, move, t.factor), 0);
}
