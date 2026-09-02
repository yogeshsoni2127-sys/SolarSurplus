import { useMemo } from 'react';
import { CloudRain, CloudSun, AlertTriangle, BatteryLow } from 'lucide-react';
import { useI18n, f } from '../i18n';
import { detectRainyWeek } from '../services/energyInsights';

export default function RainyAlertCard({ hourly }) {
  const { t } = useI18n();
  const rainy = useMemo(() => detectRainyWeek(hourly || []), [hourly]);

  const clear = !rainy;
  const accent = !clear ? (rainy.severity === 'high' ? '#f87171' : '#fbbf24') : '#34d399';
  const Icon = !clear ? CloudRain : CloudSun;

  return (
    <div className="glass-card" style={{
      borderColor: `${accent}44`,
      background: clear
        ? 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(56,189,248,0.04))'
        : 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(251,191,36,0.04))',
    }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: `${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={22} color={accent} />
        </div>
        <div style={{ flex: 1 }}>
          {clear ? (
            <>
              <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>{t('rainy.clear.title')}</h3>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>{t('rainy.clear.sub')}</p>
            </>
          ) : (
          <>
          <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            {rainy.severity === 'high' && <AlertTriangle size={16} color={accent} />}
            {f(t('rainy.title'), { n: rainy.length })}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {f(t('rainy.range'), { s: rainy.days[0].label, e: rainy.days[rainy.days.length - 1].label })}
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {rainy.days.map((d) => (
              <div key={d.date} style={{
                background: 'rgba(0,0,0,0.25)', border: `1px solid ${accent}33`, borderRadius: 10,
                padding: '6px 10px', fontSize: 12, textAlign: 'center',
              }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{d.label}</div>
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                  {f(t('rainy.clouds'), { p: Math.round(d.cloudAvg) })}%
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <BatteryLow size={15} color={accent} />
            <span>
              {f(t('rainy.battery'), { p: Math.round(rainy.batteryMinPct), st: rainy.batteryMinTime || '--' })}
            </span>
          </div>

          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {t('rainy.advice')}
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}