import { useState } from 'react';
import { SlidersHorizontal, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { useI18n, f } from '../i18n';

export default function ConsumptionFeedback({ cal, baseKwh, effectiveKwh, onAddSample, onReset }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!value) return;
    onAddSample(parseFloat(value));
    setValue('');
  };

  const samples = cal?.samples?.length || 0;

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SlidersHorizontal size={22} color="#a78bfa" />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>{t('cal.title')}</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('cal.sub')}</p>

          <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <input
              type="number"
              className="form-input"
              style={{ flex: '1 1 160px' }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('cal.placeholder')}
              min="1"
              step="0.5"
            />
            <button type="submit" className="btn btn-secondary" style={{ padding: '8px 14px', gap: 6 }}>
              <Plus size={14} /> {t('cal.add')}
            </button>
          </form>

          {samples > 0 ? (
            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
                <div style={{ color: 'var(--text-muted)' }}>{f(t('cal.samples'), { n: samples })}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#a78bfa' }}>
                  {cal.avg} kWh/day
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('cal.learnedShort')}</div>
              </div>
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
                <div style={{ color: 'var(--text-muted)' }}>{t('cal.effective')}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--emerald-400)' }}>≈{effectiveKwh} kWh/day</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 'auto' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={12} /> {t('cal.apply')}
                </span>
                <button type="button" className="btn btn-secondary" onClick={onReset} style={{ padding: '6px 12px', fontSize: 12, gap: 6 }}>
                  <RotateCcw size={13} /> {t('cal.reset')}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>{t('cal.empty')}</p>
          )}
        </div>
      </div>
    </div>
  );
}