import { useState, useEffect } from 'react';
import {
  Sun, Battery, MapPin, Calendar, Gauge,
  Zap, ArrowRight, Loader2, Search, Check, Compass, Activity
} from 'lucide-react';
import { reverseGeocode, formatLocationName } from '../services/geo';
import { useI18n, f } from '../i18n';

// Hourly consumption weights (hours 0-23) matching the backend
// CONSUMPTION_PROFILES in battery_optimizer.py. Used for the live
// load-shape preview so the user sees what they're selecting.
const PROFILE_WEIGHTS = {
  default: [0.02,0.02,0.02,0.02,0.02,0.03,0.05,0.06,0.06,0.05,0.04,0.04,0.04,0.04,0.04,0.04,0.05,0.06,0.07,0.07,0.06,0.05,0.04,0.03],
  working_9_5: [0.015,0.014,0.013,0.012,0.013,0.02,0.045,0.054,0.04,0.025,0.022,0.02,0.02,0.02,0.02,0.02,0.03,0.06,0.098,0.092,0.075,0.05,0.03,0.02],
  home_all_day: [0.035,0.032,0.03,0.028,0.03,0.035,0.05,0.06,0.055,0.05,0.045,0.045,0.045,0.045,0.045,0.045,0.05,0.06,0.065,0.06,0.05,0.04,0.035,0.03],
  night_shift: [0.045,0.05,0.055,0.06,0.055,0.045,0.04,0.035,0.03,0.025,0.025,0.03,0.035,0.035,0.04,0.04,0.045,0.05,0.05,0.045,0.04,0.04,0.045,0.05],
  ac_heavy: [0.015,0.014,0.013,0.012,0.013,0.015,0.04,0.045,0.04,0.035,0.04,0.05,0.06,0.065,0.07,0.075,0.08,0.085,0.085,0.075,0.06,0.045,0.03,0.02],
  elderly_home: [0.02,0.02,0.02,0.02,0.02,0.03,0.05,0.06,0.06,0.06,0.05,0.045,0.04,0.04,0.04,0.04,0.05,0.06,0.07,0.07,0.06,0.05,0.04,0.03],
};

const DEFAULT_VALUES = {
  solar_panel_capacity_kw: 5,
  battery_capacity_kwh: 10,
  current_battery_charge: 50,
  panel_age_years: 2,
  battery_age_years: 1,
  latitude: 25.4934,  // Prayagraj (sensible default)
  longitude: 81.8675,
  avg_daily_consumption_kwh: 15,
  tilt_deg: 30,
  azimuth_deg: 180,
  consumer_profile: 'default',
};

// Preset daily-usage tiers in kWh/day — the label text carries the kWh
// estimate, the `value` carries the number that goes to the API.
const CONS_OPTIONS = [
  { value: 5, key: 'form.opt.minimal' },
  { value: 10, key: 'form.opt.small' },
  { value: 15, key: 'form.opt.medium' },
  { value: 25, key: 'form.opt.large' },
  { value: 40, key: 'form.opt.xlarge' },
];

const DIR_OPTIONS = [
  { value: 0, key: 'form.dir.N' },
  { value: 45, key: 'form.dir.NE' },
  { value: 90, key: 'form.dir.E' },
  { value: 135, key: 'form.dir.SE' },
  { value: 180, key: 'form.dir.S.best' },
  { value: 225, key: 'form.dir.SW' },
  { value: 270, key: 'form.dir.W' },
  { value: 315, key: 'form.dir.NW' },
];

export default function InputForm({ onSubmit, loading }) {
  const { t } = useI18n();
  const [form, setForm] = useState(DEFAULT_VALUES);
  const [geoStatus, setGeoStatus] = useState('idle'); // 'detecting' | 'success' | 'failed' | 'idle'
  const [cityName, setCityName] = useState('Prayagraj, UP');
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Resolve lat/lon into a real, readable place name (BigDataCloud, free)
  const applyGeoName = async (lat, lon) => {
    const geo = await reverseGeocode(lat, lon);
    const name = formatLocationName(geo);
    if (name) {
      setCityName(name);
    } else {
      setCityName(`${lat}°N, ${lon}°E`);
    }
  };

  // Auto-detect location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      setGeoStatus('detecting');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = parseFloat(pos.coords.latitude.toFixed(4));
          const lon = parseFloat(pos.coords.longitude.toFixed(4));
          setForm((prev) => ({
            ...prev,
            latitude: lat,
            longitude: lon,
          }));
          setGeoStatus('success');
          await applyGeoName(lat, lon);
        },
        () => {
          setGeoStatus('failed');
          setCityName(t('form.citydefault'));
        },
        { timeout: 5000, enableHighAccuracy: false }
      );
    }
  }, []);

  // Search cities via Open-Meteo free geocoding API
  const handleSearchCity = async (query) => {
    setCitySearchQuery(query);
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.warn('Geocoding search failed:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectCity = (city) => {
    const lat = parseFloat(city.latitude.toFixed(4));
    const lon = parseFloat(city.longitude.toFixed(4));
    const label = `${city.name}${city.admin1 ? ', ' + city.admin1 : ''} (${city.country_code || city.country})`;
    
    setForm((prev) => ({
      ...prev,
      latitude: lat,
      longitude: lon,
    }));
    setCityName(label);
    setCitySearchQuery('');
    setShowDropdown(false);
    setGeoStatus('success');
  };

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Parse values to floats on submit to avoid 0 sticking in inputs
    const parsedForm = { ...form, city: cityName };
    if (customMode) {
      parsedForm.avg_daily_consumption_kwh = parseFloat(customValue);
    }
    for (let k in parsedForm) {
      if (k !== 'latitude' && k !== 'longitude' && k !== 'avg_daily_consumption_kwh' && k !== 'consumer_profile' && k !== 'city') {
        parsedForm[k] = parsedForm[k] === '' ? 0 : parseFloat(parsedForm[k]) || 0;
      }
    }
    onSubmit(parsedForm);
  };

  const handleGeolocate = () => {
    if (navigator.geolocation) {
      setGeoStatus('detecting');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = parseFloat(pos.coords.latitude.toFixed(4));
          const lon = parseFloat(pos.coords.longitude.toFixed(4));
          setForm((prev) => ({
            ...prev,
            latitude: lat,
            longitude: lon,
          }));
          setGeoStatus('success');
          await applyGeoName(lat, lon);
        },
        (err) => {
          console.error('Geolocation error:', err);
          setGeoStatus('failed');
        },
        { timeout: 6000, enableHighAccuracy: true }
      );
    }
  };

  return (
    <div className="glass-card slide-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div className="stat-card-icon emerald">
          <Sun size={20} />
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('form.config')}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('form.config.sub')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          {/* Solar Panel Capacity */}
          <div className="form-group">
            <label className="form-label">
              <Sun size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.panelsize')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.solar_panel_capacity_kw === 0 && form.solar_panel_capacity_kw !== '' ? '' : form.solar_panel_capacity_kw}
              onChange={(e) => handleChange('solar_panel_capacity_kw', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0.1"
              step="0.1"
              required
            />
            {t('form.panelsize.help')}
          </div>

          {/* Battery Capacity */}
          <div className="form-group">
            <label className="form-label">
              <Battery size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.batterycap')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.battery_capacity_kwh === 0 && form.battery_capacity_kwh !== '' ? '' : form.battery_capacity_kwh}
              onChange={(e) => handleChange('battery_capacity_kwh', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0.1"
              step="0.1"
              required
            />
            {t('form.batterycap.help')}
          </div>

          {/* Current Charge */}
          <div className="form-group">
            <label className="form-label">
              <Gauge size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.charge')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.current_battery_charge === 0 && form.current_battery_charge !== '' ? '' : form.current_battery_charge}
              onChange={(e) => handleChange('current_battery_charge', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0"
              max="100"
              required
            />
            {t('form.charge.help')}
          </div>

          {/* Daily Consumption */}
          <div className="form-group">
            <label className="form-label">
              <Zap size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.dailyuse')}
            </label>
            <select
              className="form-input"
              value={customMode ? '' : form.avg_daily_consumption_kwh}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') { setCustomMode(true); return; }
                setCustomMode(false);
                handleChange('avg_daily_consumption_kwh', parseFloat(v) || 0);
              }}
              required={!customMode}
            >
              <option value="" disabled hidden>{t('form.selectsize')}</option>
              {CONS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{f(t(o.key))}</option>
              ))}
              <option value="">{t('form.opt.custom')}</option>
            </select>
            {customMode && (
              <input
                type="number"
                className="form-input"
                style={{ marginTop: 8 }}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onWheel={(e) => e.target.blur()}
                placeholder={t('form.customuse.placeholder')}
                min="1"
                step="0.5"
                required
              />
            )}
            <span className="form-helper">{t('form.dailyuse.help')}</span>
          </div>

          {/* Panel Age */}
          <div className="form-group">
            <label className="form-label">
              <Calendar size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.panelage')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.panel_age_years === 0 && form.panel_age_years !== '' ? '' : form.panel_age_years}
              onChange={(e) => handleChange('panel_age_years', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0"
              step="0.5"
            />
            {t('form.panelage.help')}
          </div>

          {/* Battery Age */}
          <div className="form-group">
            <label className="form-label">
              <Calendar size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.batteryage')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.battery_age_years === 0 && form.battery_age_years !== '' ? '' : form.battery_age_years}
              onChange={(e) => handleChange('battery_age_years', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0"
              step="0.5"
            />
            {t('form.batteryage.help')}
          </div>

          {/* Panel Tilt */}
          <div className="form-group">
            <label className="form-label">
              <Compass size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.tilt')}
            </label>
            <input
              type="number"
              className="form-input"
              value={form.tilt_deg}
              onChange={(e) => handleChange('tilt_deg', e.target.value)}
              onWheel={(e) => e.target.blur()}
              min="0"
              max="90"
              step="5"
            />
            <span className="form-helper">{t('form.tilt.helper')}</span>
          </div>

          {/* Panel Azimuth */}
          <div className="form-group">
            <label className="form-label">
              <Compass size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.azimuth')}
            </label>
            <select
              className="form-input"
              value={form.azimuth_deg}
              onChange={(e) => handleChange('azimuth_deg', parseInt(e.target.value, 10))}
            >
              {DIR_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{f(t(d.key))}</option>
              ))}
            </select>
            <span className="form-helper">{t('form.azimuth.helper')}</span>
          </div>
        </div>

        {/* Daily Usage Pattern (lifestyle profile) */}
        <div style={{ marginTop: 12, padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">
              <Activity size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('form.profile')}
            </label>
            <select
              className="form-input"
              value={form.consumer_profile || 'default'}
              onChange={(e) => handleChange('consumer_profile', e.target.value)}
            >
              {['default', 'working_9_5', 'home_all_day', 'night_shift', 'ac_heavy', 'elderly_home'].map((p) => (
                <option key={p} value={p}>{t(`form.profile.p.${p}`)}</option>
              ))}
            </select>
            <span className="form-helper">{t('form.profile.help')}</span>
          </div>
          <LoadShapePreview weights={PROFILE_WEIGHTS[form.consumer_profile] || PROFILE_WEIGHTS.default} />
        </div>

        {/* Location Section */}
        <div style={{ marginTop: 12, padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={16} color="var(--emerald-400)" />
              {t('form.location')}
              {cityName && (
                <span style={{ fontSize: 12, color: 'var(--emerald-400)', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                  📍 {cityName}
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGeolocate}
              style={{ padding: '6px 12px', fontSize: 12, gap: 4 }}
            >
              {geoStatus === 'detecting' ? (
                <>
                  {<><Loader2 size={12} className="spin" /> {t('form.locating')}</>}
                </>
              ) : (
                <>
                  {<><MapPin size={12} /> {t('form.usegps')}</>}
                </>
              )}
            </button>
          </div>

          {/* City Search Bar with Autocomplete */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 12px' }}>
              <Search size={14} color="var(--text-muted)" style={{ marginRight: 8 }} />
              <input
                type="text"
                placeholder={t('search.placeholder')}
                value={citySearchQuery}
                onChange={(e) => handleSearchCity(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                style={{
                  width: '100%',
                  padding: '8px 0',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              {isSearching && <Loader2 size={14} className="spin" color="var(--emerald-400)" />}
            </div>

            {/* Dropdown Suggestions */}
            {showDropdown && searchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                background: '#1a1f2e',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                zIndex: 50,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {searchResults.map((city, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectCity(city)}
                    style={{
                      padding: '10px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      borderBottom: idx < searchResults.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16,185,129,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div>
                      <strong>{city.name}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>
                        {city.admin1 ? `${city.admin1}, ` : ''}{city.country || ''}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {city.latitude.toFixed(2)}°, {city.longitude.toFixed(2)}°
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Latitude and Longitude Inputs */}
          <div className="grid-2">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>{t('form.lat')}</label>
              <input
                type="number"
                className="form-input"
                placeholder={t('form.lat.p')}
                value={form.latitude}
                onChange={(e) => handleChange('latitude', e.target.value)}
                onWheel={(e) => e.target.blur()}
                min="-90"
                max="90"
                step="0.0001"
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>{t('form.lon')}</label>
              <input
                type="number"
                className="form-input"
                placeholder={t('form.lon.p')}
                value={form.longitude}
                onChange={(e) => handleChange('longitude', e.target.value)}
                onWheel={(e) => e.target.blur()}
                min="-180"
                max="180"
                step="0.0001"
                required
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={loading}
          style={{ width: '100%', marginTop: 16 }}
        >
          {loading ? (
            <>
              <Loader2 size={20} className="spinner" />
              {t('form.loading')}
            </>
          ) : (
            <>
              {t('form.submit')}
              <ArrowRight size={20} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// 24-bar sparkline of the selected consumption profile so the user can see
// exactly how their load is distributed through the day.
function LoadShapePreview({ weights }) {
  const { t } = useI18n();
  const max = Math.max(...weights);
  const peakIdx = weights.indexOf(max);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60, paddingTop: 6 }}>
        {weights.map((w, i) => {
          const isPeak = i === peakIdx;
          return (
            <div
              key={i}
              title={`${String(i).padStart(2, '0')}:00 – ${Math.round(w * 100)}%`}
              style={{
                flex: 1,
                height: `${(w / max) * 100}%`,
                minHeight: 3,
                borderRadius: '2px 2px 0 0',
                background: isPeak ? 'var(--amber-400)' : 'rgba(245,158,11,0.55)',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
        {['00', '06', '12', '18', '24'].map((h) => (
          <span key={h}>{h}:00</span>
        ))}
      </div>
      {max > 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber-400)', marginTop: 4 }}>
          {f(t('form.profile.peak'), { h: peakIdx })}
        </div>
      )}
    </div>
  );
}
