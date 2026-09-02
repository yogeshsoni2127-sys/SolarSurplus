"""Pydantic schemas for API request/response models."""

from pydantic import BaseModel, Field
from typing import Optional


class UserInput(BaseModel):
    """User's solar + battery system configuration."""
    solar_panel_capacity_kw: float = Field(..., gt=0, description="Solar panel capacity in kW")
    battery_capacity_kwh: float = Field(..., gt=0, description="Battery capacity in kWh")
    current_battery_charge: float = Field(
        default=50.0, ge=0, le=100,
        description="Current battery state of charge (%)"
    )
    panel_age_years: float = Field(default=0, ge=0, description="Age of solar panels in years")
    battery_age_years: float = Field(default=0, ge=0, description="Age of battery in years")
    latitude: float = Field(..., ge=-90, le=90, description="Location latitude")
    longitude: float = Field(..., ge=-180, le=180, description="Location longitude")
    avg_daily_consumption_kwh: float = Field(
        default=10.0, gt=0,
        description="Average daily energy consumption in kWh"
    )
    # Optional panel orientation so irradiance is projected onto the module plane
    tilt_deg: float = Field(default=0, ge=0, le=90, description="Panel tilt from horizontal (°)")
    azimuth_deg: float = Field(default=180, ge=0, le=360, description="Panel azimuth from North (°; 180 = South)")
    language: str = Field(default="en", description="Output language for recommendation texts ('en' or 'hi')")
    consumer_profile: str = Field(
        default="default",
        max_length=64,
        description="Hourly consumption shape: default | working_9_5 | home_all_day | night_shift | ac_heavy | elderly_home"
    )
    client_weather_data: Optional[dict] = Field(
        default=None,
        description="Optional pre-fetched weather data from the client to bypass backend IP rate limits"
    )


class HourlyForecast(BaseModel):
    """Single hour forecast entry."""
    hour: int
    timestamp: str
    temperature: float
    wind_speed: float = 0.0  # Wind speed in m/s
    humidity: float = 0.0  # Relative humidity in %
    cloud_cover: float
    ghi: float  # Global Horizontal Irradiance (W/m²)
    dni: float = 0.0  # Direct Normal Irradiance (W/m²)
    dhi: float = 0.0  # Diffuse Horizontal Irradiance (W/m²)
    cell_temperature: Optional[float] = None  # Operating PV cell temperature (°C)
    predicted_generation_kwh: float
    estimated_consumption_kwh: float
    surplus_kwh: float
    battery_action: str  # "charge", "discharge", "idle"
    grid_export_kwh: float = 0.0  # Surplus exported to grid (battery full)
    battery_charge_kwh: float
    battery_soc_percent: float


class PredictionResponse(BaseModel):
    """Complete forecast response."""
    location: dict
    system_info: dict
    hourly_forecast: list[HourlyForecast]
    daily_summary: dict
    recommendations: list[str]
    model_used: str = "XGBoost + Weather API"
    weather_data_source: str = "Open-Meteo (Best Match)"


class WeatherForecast(BaseModel):
    """Weather forecast response."""
    latitude: float
    longitude: float
    timezone: str
    hourly: list[dict]
    daily_summary: Optional[dict] = None
