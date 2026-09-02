"""Smoke tests for the prediction API and solar geometry."""

import math
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.solar_geometry import tilt_irradiance


def _synthetic_weather(hours: int = 168, start: str = "2026-09-02T00:00"):
    start_dt = datetime.fromisoformat(start)
    hourly = []
    for i in range(hours):
        dt = start_dt + timedelta(hours=i)
        hour = dt.hour
        ghi = max(0.0, 700.0 * math.sin(math.pi * (hour - 6) / 12.0) if 6 <= hour <= 18 else 0.0)
        hourly.append({
            "timestamp": dt.strftime("%Y-%m-%dT%H:%M"),
            "temperature": 25 + hour / 3,
            "humidity": 60,
            "wind_speed": 5,
            "cloud_cover": 10,
            "ghi": round(ghi, 1),
            "dni": round(ghi * 0.85, 1),
            "dhi": round(ghi * 0.15, 1),
        })
    return {"timezone": "Asia/Kolkata", "data_source": "Open-Meteo (Client Fetch)", "hourly": hourly}


_BASE = {
    "latitude": 25.4,
    "longitude": 81.9,
    "solar_panel_capacity_kw": 5,
    "battery_capacity_kwh": 10,
    "avg_daily_consumption_kwh": 10,
    "current_battery_charge": 70,
    "panel_age_years": 0,
    "battery_age_years": 0,
    "tilt_deg": 0,
    "azimuth_deg": 180,
}


def test_forecast_endpoint_returns_full_prediction():
    client = TestClient(app)
    body = dict(_BASE)
    body["client_weather_data"] = _synthetic_weather()
    resp = client.post("/api/predict/forecast", json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["hourly_forecast"]) >= 168
    assert data["model_used"] in {
        "LSTM Neural Network",
        "XGBoost Regressor",
        "Physics-Based Estimation",
        "LSTM Neural Network (with Estimated Weather)",
    }
    assert data["system_info"]["panel_capacity_kw"] == 5
    assert data["daily_summary"]
    # Generation must be clamped by capacity
    peaks = [h["predicted_generation_kwh"] for h in data["hourly_forecast"]]
    assert max(peaks) <= 5.0 + 1e-6


def test_forecast_without_client_weather_falls_back():
    client = TestClient(app)
    body = dict(_BASE)
    body["client_weather_data"] = None
    resp = client.post("/api/predict/forecast", json=body)
    # Backend Open-Meteo fetch may fail (rate limits / no network) -> must not 500
    assert resp.status_code == 200


def test_flat_tilt_keeps_ghi_and_tilted_changes_it():
    hour = {
        "timestamp": "2026-09-02T12:00",
        "ghi": 700.0, "dni": 595.0, "dhi": 105.0, "temperature": 30,
    }
    flat = tilt_irradiance(hour, 25.4, 81.9, 0, 180)
    assert flat["ghi"] == pytest.approx(700.0, abs=1e-6)

    tilted = tilt_irradiance(hour, 25.4, 81.9, 30, 180)
    # A south-facing 30° panel on a September midday in India does not crash
    # and yields a meaningful projection value.
    assert 0.0 <= tilted["ghi"] <= 1400.0
    assert tilted["solar_elevation_deg"] > 0
    assert tilted["ghi"] != pytest.approx(700.0, abs=1e-3)


def test_tilt_geometry_night_zeroes_irradiance():
    hour = {
        "timestamp": "2026-09-02T00:00",
        "ghi": 0.0, "dni": 0.0, "dhi": 0.0, "temperature": 22,
    }
    tilted = tilt_irradiance(hour, 25.4, 81.9, 30, 180)
    assert tilted["ghi"] == 0.0
    assert tilted["dni"] == 0.0
    assert tilted["dhi"] == 0.0


def test_consumer_profiles_change_hourly_consumption_shape():
    from app.services.battery_optimizer import calculate_battery_schedule

    generation = [0.0] * 24  # flat zero generation isolates the consumption profile
    def hourly_cons(profile):
        res = calculate_battery_schedule(
            hourly_generation=generation,
            avg_daily_consumption_kwh=24.0,
            battery_capacity_kwh=10,
            current_charge_percent=100,
            battery_age_years=0,
            consumer_profile=profile,
        )["schedule"]
        return {e["hour_of_day"]: e["consumption_kwh"] for e in res}

    worker = hourly_cons("working_9_5")
    night = hourly_cons("night_shift")

    # Daytime (12:00) consumption collapses for a 9-5 worker vs night-shift,
    # while late evening (20:00) is the worker's peak.
    assert worker[12] < night[12] * 0.7
    assert worker[20] > night[20] * 1.3

    # A flat default profile must still equal an exactly-normalised load.
    default = hourly_cons("default")
    assert sum(default.values()) == pytest.approx(24.0, abs=0.01)

    # Unknown profile name falls back to the default curve, not a crash.
    fallback = hourly_cons("not_a_real_profile")
    assert sum(fallback.values()) == pytest.approx(24.0, abs=0.01)