import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { generateForecast, warmUpBackend } from './services/api';
import { saveUserEntry, savePrediction, saveNotification } from './services/firebase';
import { useI18n, f } from './i18n';

import Navbar from './components/Navbar';
import AuthModal from './components/AuthModal';
import InputForm from './components/InputForm';
import StatCards from './components/StatCards';
import BatteryStatus from './components/BatteryStatus';
import WeatherPanel from './components/WeatherPanel';
import Recommendations from './components/Recommendations';
import NotificationCenter from './components/NotificationCenter';
import UserHistory from './components/UserHistory';
import ExportReport from './components/ExportReport';
import LiveBackground from './components/LiveBackground';

// Heavy chart components are lazy-loaded to shrink the initial JS bundle
// (recharts alone is ~800 kB).
const ForecastChart = lazy(() => import('./components/ForecastChart'));
const SurplusTimeline = lazy(() => import('./components/SurplusTimeline'));
const GridExportCard = lazy(() => import('./components/GridExportCard'));
const SavingsCard = lazy(() => import('./components/SavingsCard'));
const RainyAlertCard = lazy(() => import('./components/RainyAlertCard'));
const EvScheduler = lazy(() => import('./components/EvScheduler'));

const ChartSuspense = () => (
  <div className="chart-suspense">
    <div className="spinner"></div>
  </div>
);

function formatAgo(ts, t) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return t('ago.now');
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return f(t('ago.mins'), { m: String(mins) });
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return f(t('ago.hrs'), { h: String(hrs), m: String(rem) });
}

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAuth, setShowAuth] = useState(false);
  const [predictions, setPredictions] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [lastInput, setLastInput] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('solar_predictions');
    if (saved) {
      try {
        setPredictions(JSON.parse(saved));
      } catch (e) {}
    }
    try {
      const li = localStorage.getItem('solar_last_input');
      if (li) setLastInput(JSON.parse(li));
      setGeneratedAt(Number(localStorage.getItem('solar_predictions_ts')) || null);
    } catch (e) {}
  }, []);

  // Warm up the ML backend on load and keep it awake so forecasts use LSTM/XGBoost
  // instead of timing out on a sleeping Render instance.
  useEffect(() => {
    warmUpBackend();
    const t = setInterval(() => warmUpBackend(), 240000);
    return () => clearInterval(t);
  }, []);

  const handleForecast = useCallback(async (formData) => {
    setForecastLoading(true);
    try {
      const result = await generateForecast(formData);
      setPredictions(result);
      setLastInput(formData);
      setGeneratedAt(Date.now());
      setActiveTab('dashboard');

      // Save to local storage to persist across refresh
      localStorage.setItem('solar_predictions', JSON.stringify(result));
      localStorage.setItem('solar_last_input', JSON.stringify(formData));
      localStorage.setItem('solar_predictions_ts', String(Date.now()));

      // Notify users when the ML backend is down so they know why the
      // numbers changed vs a previous LSTM run.
      if (result.model_used?.includes('Physics')) {
        toast(t('toast.backenddown'), {
          icon: '⚠️',
          duration: 6000,
          style: { background: '#111827', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.3)' },
        });
      } else {
        toast.success(t('toast.success'), {
          style: {
            background: '#111827',
            color: '#f1f5f9',
            border: '1px solid rgba(16, 185, 129, 0.3)',
          },
          iconTheme: { primary: '#10B981', secondary: '#fff' },
        });
      }

      // Save to Firebase if authenticated (fire and forget to avoid blocking UI)
      if (user) {
        saveUserEntry(user.uid, formData).catch(e => console.warn(e));
        savePrediction(user.uid, {
          daily_summary: result.daily_summary,
          model_used: result.model_used,
          input: formData,
        }).catch(e => console.warn(e));

        if (result.daily_summary?.total_surplus_kwh > 0) {
          saveNotification(user.uid, {
            type: 'surplus',
            title: t('note.surplus.title'),
            message: f(t('notify.surplus.msg'), { kwh: result.daily_summary.total_surplus_kwh.toFixed(1) }),
          }).catch(e => console.warn(e));
        }
      }
    } catch (err) {
      console.error('Forecast error:', err);
      toast.error(
        err.message.includes('fetch')
          ? t('toast.err.connect')
          : f(t('toast.err.fail'), { msg: err.message }),
        {
          style: {
            background: '#111827',
            color: '#f1f5f9',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          },
          duration: 6000,
        }
      );
    } finally {
      setForecastLoading(false);
    }
  }, [user, t]);

  const handleAuth = (authUser) => {
    setShowAuth(false);
    toast.success(f(t('toast.welcome'), { email: authUser.email }), {
      style: { background: '#111827', color: '#f1f5f9', border: '1px solid rgba(16, 185, 129, 0.3)' },
    });
  };

  // Get latest battery state from prediction
  const latestBattery = predictions?.hourly_forecast?.length
    ? predictions.hourly_forecast[predictions.hourly_forecast.length - 1]
    : null;

  const batteryHistory = predictions?.hourly_forecast?.slice(-24).map((h) => h.battery_soc_percent || 0) || [];

  // Location for tariff/net-metering features (latest input, or stored prediction)
  const dashboardLocation =
    lastInput || predictions?.location || null;

  // Current battery action — match against the *forecast's* day-0 by hour-of-day
  // so a forecast in another timezone still picks the right state for "now".
  const currentAction = predictions?.hourly_forecast?.length
    ? (() => {
        const nowHour = new Date().getHours();
        const day0 = predictions.hourly_forecast.slice(0, 24);
        const match = day0.find((h) => new Date(h.timestamp).getHours() === nowHour)
          || day0[0]
          || predictions.hourly_forecast[0];
        return match?.battery_action || 'idle';
      })()
    : 'idle';

  const isFallback = Boolean(predictions?.model_used?.includes('Physics'));
  const isEstimated = predictions?.weather_data_source === 'estimated';

  if (authLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#020617' }}>
        <div className="spinner" style={{ width: 40, height: 40, border: '3px solid #10B981', borderLeftColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ marginTop: 16, color: '#94a3b8' }}>{t('loading.dashboard')}</p>
      </div>
    );
  }

  return (
    <>
      <LiveBackground />
      <Toaster position="top-right" />
      <Navbar
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onAuth={handleAuth}
        />
      )}

      <div className="page-container">
        {/* Header */}
        <div className="page-header fade-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">
              {activeTab === 'dashboard' && t('title.dashboard')}
              {activeTab === 'forecast' && t('title.forecast')}
              {activeTab === 'notifications' && t('title.notifications')}
              {activeTab === 'history' && t('title.history')}
            </h1>
            <p className="page-subtitle">
              {activeTab === 'dashboard' && t('subtitle.dashboard')}
              {activeTab === 'forecast' && t('subtitle.forecast')}
              {activeTab === 'notifications' && t('subtitle.notifications')}
              {activeTab === 'history' && t('subtitle.history')}
            </p>
          </div>
          {!user && (
            <button
              className="btn btn-primary"
              onClick={() => setShowAuth(true)}
            >
              {t('signin.cta')}
            </button>
          )}
        </div>

        {/* ─── Dashboard Tab ─────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            {predictions ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: 10 }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '4px 12px',
                    borderRadius: '20px',
                    background: isFallback ? 'rgba(251, 191, 36, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                    color: isFallback ? '#fbbf24' : '#a78bfa',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    {t('engine')}: {predictions.model_used}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {generatedAt && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {t('generated.ago')}: {formatAgo(generatedAt, t)} · {t('dashboard.stale.hint')}
                      </span>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={() => lastInput && handleForecast(lastInput)}
                      disabled={!lastInput || forecastLoading}
                      style={{ padding: '6px 12px', fontSize: 12, gap: 6 }}
                    >
                      <RefreshCw size={13} className={forecastLoading ? 'spin' : ''} />
                      {t('regenerate')}
                    </button>
                    <ExportReport
                      hourly={predictions.hourly_forecast}
                      summary={predictions.daily_summary}
                    />
                  </div>
                </div>

                {(isFallback || isEstimated) && (
                  <div className="fallback-banner" style={{ marginBottom: 16 }}>
                    <AlertTriangle size={15} />
                    {isFallback ? t('fallback.banner') : t('estimated.banner')}
                  </div>
                )}

                <StatCards summary={predictions.daily_summary} />

                <div style={{ marginTop: 24 }}>
                  <Suspense fallback={null}>
                    <RainyAlertCard hourly={predictions.hourly_forecast} />
                  </Suspense>
                </div>

                {predictions.daily_summary && (
                  <div style={{ marginTop: 24, display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                    <Suspense fallback={<ChartSuspense />}>
                      <GridExportCard
                        summary={predictions.daily_summary}
                        latitude={dashboardLocation?.latitude}
                        longitude={dashboardLocation?.longitude}
                      />
                    </Suspense>
                    <Suspense fallback={<ChartSuspense />}>
                      <SavingsCard
                        summary={predictions.daily_summary}
                        input={lastInput}
                      />
                    </Suspense>
                  </div>
                )}

                <div style={{ marginTop: 24 }}>
                  <Suspense fallback={<ChartSuspense />}>
                    <ForecastChart
                      data={predictions.hourly_forecast}
                      title={t('chart.forecast48')}
                    />
                  </Suspense>
                </div>

                <div className="grid-2" style={{ marginTop: 24 }}>
                  <Suspense fallback={<ChartSuspense />}>
                    <SurplusTimeline data={predictions.hourly_forecast} />
                  </Suspense>
                  <BatteryStatus
                    soc={latestBattery?.battery_soc_percent || 50}
                    action={currentAction}
                    capacityKwh={predictions.daily_summary?.usable_battery_capacity_kwh || 10}
                    chargeKwh={latestBattery?.battery_charge_kwh || 5}
                    socHistory={batteryHistory}
                    health={predictions.daily_summary?.battery_health_percent}
                  />
                </div>

                <div className="grid-2" style={{ marginTop: 24 }}>
                  <WeatherPanel weatherData={predictions.hourly_forecast} dataSource={predictions.weather_data_source} />
                  <Recommendations recommendations={predictions.recommendations} />
                </div>

                <div style={{ marginTop: 24 }}>
                  <Suspense fallback={null}>
                    <EvScheduler hourly={predictions.hourly_forecast} />
                  </Suspense>
                </div>
              </>
            ) : (
              <div style={{ maxWidth: 700, margin: '0 auto' }}>
                <div className="empty-state glass-card">
                  <div className="empty-state-icon">☀️</div>
                  <h3>{t('empty.title')}</h3>
                  <p>{t('empty.text')}</p>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 24 }}
                    onClick={() => setActiveTab('forecast')}
                  >
                    {t('empty.cta')} →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Forecast Tab ──────────────────────────── */}
        {activeTab === 'forecast' && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <InputForm onSubmit={handleForecast} loading={forecastLoading} />
          </div>
        )}

        {/* ─── Notifications Tab ─────────────────────── */}
        {activeTab === 'notifications' && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <NotificationCenter predictions={predictions} location={dashboardLocation} />
          </div>
        )}

        {/* ─── History Tab ───────────────────────────── */}
        {activeTab === 'history' && (
          <UserHistory
            user={user}
            onRestore={(entry) => {
              handleForecast(entry);
            }}
          />
        )}
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '32px 24px',
        color: 'var(--text-muted)',
        fontSize: 13,
        borderTop: '1px solid var(--border-color)',
        marginTop: 48,
      }}>
        <p>{t('footer.tagline')}</p>
        <p style={{ marginTop: 4 }}>
          {t('footer.tech')}
        </p>
      </footer>
    </>
  );
}