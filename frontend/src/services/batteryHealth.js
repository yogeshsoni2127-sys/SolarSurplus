/**
 * Battery state-of-health model (frontend twin of
 * backend `battery_optimizer.calculate_battery_health`). Kept in sync so the
 * offline fallback engine and the Battery card show the same numbers.
 */

const CHEMISTRY = {
  lead_acid: { cycleLifeEq: 1200, calendarRatePctYr: 0.025 },
  lithium:   { cycleLifeEq: 4500, calendarRatePctYr: 0.015 },
};

const DRAIN = {
  heavy:    { cyclesYr: 350, dod: 0.85 },
  moderate: { cyclesYr: 200, dod: 0.55 },
  light:    { cyclesYr: 40,  dod: 0.30 },
};

const PLACEMENT_TEMP = { indoor: 27.5, outdoor: 38.0 };

export const EOL_SOH = 0.8;
export const SOIL_FLOOR = 0.5;

export function batteryHealth(ageYears = 0, type = 'unknown', drain = 'moderate', placement = 'indoor') {
  const chem = CHEMISTRY[type] || CHEMISTRY.lead_acid; // unknown → conservative
  const d = DRAIN[drain] || DRAIN.moderate;
  const tempC = PLACEMENT_TEMP[placement] ?? PLACEMENT_TEMP.indoor;

  const tempFactor = 2 ** ((tempC - 25) / 10);
  const eqCyclesPerYr = d.cyclesYr * (d.dod ** 1.1);
  const cycleLossPerYr = eqCyclesPerYr * (1 - EOL_SOH) / chem.cycleLifeEq;
  const calLossPerYr = chem.calendarRatePctYr;
  const annualLoss = (cycleLossPerYr + calLossPerYr) * tempFactor;
  const totalLoss = annualLoss * Math.max(0, ageYears);

  const health = Math.max(SOIL_FLOOR, Math.min(1, 1 - totalLoss));
  return {
    healthFraction: health,
    healthPercent: Math.round(health * 1000) / 10,
    degradationFactor: Math.round(health * 10000) / 10000,
    temperatureC: Math.round(tempC * 10) / 10,
    tempFactor: Math.round(tempFactor * 100) / 100,
    eqCyclesPerYr: Math.round(eqCyclesPerYr * 10) / 10,
    annualLoss: Math.round(annualLoss * 100000) / 100000,
    chemistry: type === 'lithium' ? 'lithium' : 'lead_acid',
  };
}