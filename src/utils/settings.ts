const DEFAULTS: Settings = {
  minDrones: 2,
  maxDrones: 20,
  spotUtilization: 0.5,
  minRouteReturn: 3,
  showRoutes: false,
  showDefense: false,
  towerExposureCost: 3,
  showCore: false,
  showZones: false,
  upgradeShare: 0.6,
};

/**
 * Tuning knob, overridable from the in-game console without redeploying, e.g.
 * `Memory.settings = { minDrones: 4 }`. Unset keys fall back to DEFAULTS.
 */
export function setting<K extends keyof Settings>(key: K): Settings[K] {
  return Memory.settings?.[key] ?? DEFAULTS[key];
}
