/**
 * Derived energy-intelligence helpers. Both features compute everything from
 * the already-returned hourly forecast (backend and offline fallback share
 * the same field shape), so they work with zero extra network calls.
 */

const pad = (n) => String(n).padStart(2, '0');

/** "2026-09-02T00:00" -> "Sep 2" */
export function shortDate(ts) {
  if (!ts) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ts);
  if (!m) return ts.slice(0, 10);
  const [, year, mo, day] = m;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[+mo - 1]} ${+day}`;
}

const hourOf = (e) => (e.hour_of_day !== undefined ? e.hour_of_day : (e.hour || 0) % 24);
const dateOf = (e) => (e.timestamp ? String(e.timestamp).slice(0, 10) : '');
const timeOf = (e) => {
  const t = (e.timestamp || '').slice(11, 16);
  return t && /^\d{2}:\d{2}$/.test(t) ? t : `${pad(hourOf(e))}:00`;
};

/**
 * Detect a "rainy week" — a run of >=2 consecutive cloudy days — from the
 * hourly forecast. Also projects how low the battery drains inside the window.
 *
 * Returns null when no rainy stretch (or returns early silently).
 */
export function detectRainyWeek(hourly, opts = {}) {
  const { cloudThreshold = 65, peakGhiThreshold = 350, minRun = 2 } = opts;
  if (!Array.isArray(hourly) || hourly.length < 24 * minRun) return null;

  const byDate = {};
  for (const e of hourly) {
    const d = dateOf(e);
    if (!d || e.cloud_cover === undefined) return null;
    if (!byDate[d]) byDate[d] = { clouds: [], ghi: [] };
    byDate[d].clouds.push(e.cloud_cover || 0);
    byDate[d].ghi.push(e.ghi || 0);
  }

  const dates = Object.keys(byDate).sort();
  const isCloudy = (d) => {
    const a = byDate[d];
    const cloudAvg = a.clouds.reduce((x, y) => x + y, 0) / a.clouds.length;
    const peakGhi = Math.max(...a.ghi);
    return cloudAvg > cloudThreshold || peakGhi < peakGhiThreshold;
  };

  let best = [];
  for (let i = 0; i < dates.length; i++) {
    if (!isCloudy(dates[i])) continue;
    let j = i;
    while (j + 1 < dates.length && isCloudy(dates[j + 1])) j++;
    const run = dates.slice(i, j + 1);
    if (run.length > best.length) best = run;
    i = j;
  }
  if (best.length < minRun) return null;

  // Battery projection over the rainy window (inclusive dates).
  let minSoc = 100, minSocTime = '';
  for (const e of hourly) {
    const d = dateOf(e);
    if (best.includes(d)) {
      const soc = e.battery_soc_percent !== undefined ? e.battery_soc_percent : 100;
      if (soc < minSoc) { minSoc = soc; minSocTime = timeOf(e); }
    }
  }

  return {
    startDate: best[0],
    endDate: best[best.length - 1],
    length: best.length,
    severity: best.length >= 3 ? 'high' : 'medium',
    days: best.map((d) => {
      const a = byDate[d];
      const cloudAvg = a.clouds.reduce((x, y) => x + y, 0) / a.clouds.length;
      return { date: d, cloudAvg, peakGhi: Math.max(...a.ghi), label: shortDate(d) };
    }),
    batteryMinPct: minSoc,
    batteryMinTime: minSocTime,
  };
}

/**
 * Find the best EV charging windows — contiguous hours where solar surplus
 * exceeds the draw the EV needs, so the car charges off free solar instead of
 * the grid.
 *
 * ev: { capacityKwh, currentPct, targetPct, chargeRateKw, minSurplusKw,
 *       gridRateRs }
 */
export function findEvWindows(hourly, ev = {}) {
  const cap = ev.capacityKwh || 40;
  const current = ev.currentPct ?? 20;
  const target = ev.targetPct ?? 100;
  const rate = ev.chargeRateKw || 7.0;
  const minSurplus = ev.minSurplusKw ?? 1.5;
  const gridRate = ev.gridRateRs ?? 6.5;

  const needed = ((target - current) / 100) * cap;
  if (needed <= 0) {
    return { needed, charged: 0, remaining: 0, savedRs: 0, windows: [], mode: 'done' };
  }
  if (!Array.isArray(hourly) || hourly.length === 0) {
    return { needed, charged: 0, remaining: needed, savedRs: 0, windows: [], mode: 'nohours' };
  }

  // Candidate hours with enough surplus.
  const candidates = hourly
    .map((e, idx) => ({ idx, e, surplus: e.surplus_kwh || 0 }))
    .filter((c) => c.surplus >= minSurplus);

  // Merge into contiguous runs (adjacent forecast indices).
  const runs = [];
  for (const c of candidates) {
    const last = runs[runs.length - 1];
    if (last && c.idx === last.end.idx + 1) {
      last.hours.push(c);
      last.end = c;
    } else {
      runs.push({ hours: [c], end: c });
    }
  }
  if (!runs.length) {
    return { needed, charged: 0, remaining: needed, savedRs: 0, windows: [], mode: 'nosurplus' };
  }

  // Pick run "value" = how much of it the EV can actually draw.
  const value = (run) => run.hours.reduce((s, h) => s + Math.min(h.surplus, rate), 0);
  runs.forEach((r) => { r.value = value(r); });
  runs.sort((a, b) => b.value - a.value);

  let remaining = needed;
  const windows = [];
  for (const run of runs) {
    if (remaining <= 1e-6) break;
    let drawn = 0;
    const taken = [];
    for (const h of run.hours) {
      if (remaining <= 1e-6) break;
      const d = Math.min(rate, h.surplus, remaining);
      drawn += d;
      remaining -= d;
      taken.push(h);
    }
    if (drawn <= 1e-6) continue;
    const startH = taken[0];
    const endH = taken[taken.length - 1];
    windows.push({
      date: dateOf(startH.e) || shortDate(startH.e.timestamp),
      dateLabel: shortDate(startH.e.timestamp),
      start: timeOf(startH.e),
      end: timeOf(endH.e),
      hours: taken.length,
      freeKwh: +drawn.toFixed(2),
    });
  }
  windows.sort((a, b) => (a.date < b.date ? -1 : 1));

  const charged = +(needed - remaining).toFixed(2);
  return {
    needed: +needed.toFixed(2),
    charged,
    remaining: +Math.max(0, remaining).toFixed(2),
    savedRs: +(charged * gridRate).toFixed(2),
    windows,
    mode: charged > 0 ? 'partial' : 'nosurplus',
  };
}