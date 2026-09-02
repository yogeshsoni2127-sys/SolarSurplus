/**
 * Online consumption calibration ("learn" the daily kWh total from real meter
 * reads) WITHOUT touching the lifestyle profile — the preset keeps deciding the
 * hourly shape, this layer only corrects the daily scale toward measured usage.
 *
 * Simple exponential-moving-average (EWMA) online learner stored in
 * localStorage; no model retraining, works offline.
 */

const KEY = 'solar_consumption_calibration';
const MAX_SAMPLES = 60;
const EWMA_ALPHA = 0.4;   // how fast a sample moves the learned average
const MEASURED_WEIGHT = 0.65; // trust actuals over the typed value

export function readCalibration() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!Array.isArray(c.samples)) return null;
    return { samples: c.samples, avg: typeof c.avg === 'number' ? c.avg : null };
  } catch (e) {
    return null;
  }
}

function write(cal) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cal));
  } catch (e) {}
}

export function addSample(kwh) {
  const val = Number(kwh);
  if (!Number.isFinite(val) || val <= 0) return readCalibration();
  const c = readCalibration() || { samples: [], avg: null };
  const samples = [...c.samples, val].slice(-MAX_SAMPLES);
  const avg =
    c.avg === null
      ? val
      : EWMA_ALPHA * val + (1 - EWMA_ALPHA) * c.avg;
  const next = { samples, avg: Math.round(avg * 100) / 100 };
  write(next);
  return next;
}

export function resetCalibration() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {}
  return null;
}

/** Blend a user-typed daily kWh with the learned actual average. */
export function applyCalibration(baseKwh, cal) {
  const base = Number(baseKwh);
  if (!cal || cal.avg === null || !Number.isFinite(base)) return base;
  const blended = MEASURED_WEIGHT * cal.avg + (1 - MEASURED_WEIGHT) * base;
  return Math.min(120, Math.max(1, Math.round(blended * 100) / 100));
}