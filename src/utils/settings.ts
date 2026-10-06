const DEFAULTS: Settings = {
  minDrones: 2,
  builders: 2,
  upgradeShare: 0.6,
};

/**
 * Tuning knob, overridable from the in-game console without redeploying, e.g.
 * `Memory.settings = { minDrones: 4 }`. Unset keys fall back to DEFAULTS.
 */
export function setting<K extends keyof Settings>(key: K): Settings[K] {
  return Memory.settings?.[key] ?? DEFAULTS[key];
}
