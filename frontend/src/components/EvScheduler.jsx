import { useMemo, useState } from 'react';
import { Car, Zap, Info } from 'lucide-react';
import { useI18n, f } from '../i18n';
import { findEvWindows } from '../services/energyInsights';

export default function EvScheduler({ hourly }) {
  const { t } = useI18n();
  const [cap, setCap] = useState(40);
  const [current, setCurrent] = useState(20);
  const [target, setTarget] = useState(100);
  const [rate, setRate] = useState(7);

  const result = useMemo(
    () => findEvWindows(hourly || [], { capacityKwh: cap, currentPct: current, targetPct: target, chargeRateKw: rate }),
    [hourly, cap, current, target, rate],
  );

  const num = (label, value, setter, min = 0, max = 500, step = 1) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
      {label}
      <input
        type="number"
        className="form-input"
        value={value}
        onChange={(e) => setter(parseFloat(e.target.value) || 0)}
        onWheel={(e) => e.target.blur()}
        min={min} max={max} step={step}
      />
    </label>
  );

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Car size={22} color="var(--emerald-400)" />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>{t('ev.title')}</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('ev.sub')}</p>

          <div className="grid-2" style={{ marginTop: 14, gap: 10 }}>
            {num(t('ev.battsize'), cap, setCap, 1, 200, 1)}
            {num(t('ev.cur'), current, setCurrent, 0, 100, 1)}
            {num(t('ev.target'), target, setTarget, 0, 100, 1)}
            {num(t('ev.rate'), rate, setRate, 1, 50, 0.5)}
          </div>

          {(result.mode === 'nosurplus' || (result.mode === 'partial' && result.windows.length === 0)) ? (
            <p style={{ marginTop: 14, fontSize: 13, color: '#fbbf24', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Info size={15} /> {t('ev.empty')}
            </p>
          ) : (
            <>
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>{t('ev.need')}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--emerald-400)' }}>{result.needed} kWh</div>
                </div>
                <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>{t('ev.free')}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#60a5fa' }}>{result.charged} kWh</div>
                </div>
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>{t('ev.saved.short')}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fbbf24' }}>₹{result.savedRs}</div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                {result.windows.map((w, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 10, marginBottom: 6,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)',
                    fontSize: 13,
                  }}>
                    <Zap size={14} color="var(--emerald-400)" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, minWidth: 56 }}>{w.dateLabel}</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {f(t('ev.window'), { s: w.start, e: w.end, h: w.hours })}
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {w.freeKwh} kWh
                    </span>
                  </div>
                ))}
              </div>

              {result.mode === 'partial' && result.remaining > 0.01 && (
                <p style={{ marginTop: 10, fontSize: 12, color: '#fbbf24' }}>
                  {f(t('ev.remaining'), { r: result.remaining })}
                </p>
              )}

              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {t('ev.batteryfirst')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}