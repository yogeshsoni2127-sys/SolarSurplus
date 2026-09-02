"""Prediction API endpoints."""

from fastapi import APIRouter, HTTPException
from app.models.schemas import UserInput, PredictionResponse, HourlyForecast
from app.services.weather_service import fetch_weather_forecast
from app.services.solar_predictor import predictor
from app.services.battery_optimizer import calculate_battery_schedule
from app.services.solar_geometry import tilt_irradiance

router = APIRouter()

# Try loading models on import
predictor.load_models()


@router.post("/forecast", response_model=PredictionResponse)
async def generate_forecast(user_input: UserInput):
    """
    Generate solar surplus energy forecast.

    1. Fetch weather forecast for user's location
    2. Predict solar generation using ML model (or physics fallback)
    3. Calculate surplus and battery schedule
    4. Return full forecast with recommendations
    """
    try:
        # 1. Fetch weather data (use client data if provided)
        if user_input.client_weather_data:
            weather = user_input.client_weather_data
        else:
            weather = await fetch_weather_forecast(
                user_input.latitude,
                user_input.longitude,
                forecast_days=7,
            )
        weather_hours = weather["hourly"]

        # 1b. Project irradiance onto the module plane if panel orientation is set
        if user_input.tilt_deg and user_input.tilt_deg > 0:
            weather_hours = [
                tilt_irradiance(
                    wh,
                    latitude=user_input.latitude,
                    longitude=user_input.longitude,
                    tilt_deg=user_input.tilt_deg,
                    azimuth_deg=user_input.azimuth_deg,
                )
                for wh in weather_hours
            ]

        # 2. Predict solar generation
        generation = predictor.predict_generation(
            weather_hours,
            user_input.solar_panel_capacity_kw,
            user_input.panel_age_years,
        )

        # 3. Calculate battery schedule
        battery_result = calculate_battery_schedule(
            hourly_generation=generation,
            avg_daily_consumption_kwh=user_input.avg_daily_consumption_kwh,
            battery_capacity_kwh=user_input.battery_capacity_kwh,
            current_charge_percent=user_input.current_battery_charge,
            battery_age_years=user_input.battery_age_years,
            language=user_input.language,
            consumer_profile=user_input.consumer_profile,
        )

        # 4. Build hourly forecast entries
        from app.services.weather_service import calculate_cell_temperature

        hourly_forecast = []
        for i, (weather_h, sched) in enumerate(
            zip(weather_hours[:len(generation)], battery_result["schedule"])
        ):
            amb_temp = float(weather_h.get("temperature", 0))
            ghi_val = float(weather_h.get("ghi", 0))
            wind_val = float(weather_h.get("wind_speed", 0))
            cell_temp = calculate_cell_temperature(amb_temp, ghi_val, wind_val)

            hourly_forecast.append(HourlyForecast(
                hour=i,
                timestamp=weather_h.get("timestamp", ""),
                temperature=amb_temp,
                wind_speed=wind_val,
                humidity=float(weather_h.get("humidity", 0)),
                cloud_cover=float(weather_h.get("cloud_cover", 0)),
                ghi=ghi_val,
                dni=float(weather_h.get("dni", 0)),
                dhi=float(weather_h.get("dhi", 0)),
                cell_temperature=cell_temp,
                predicted_generation_kwh=sched["generation_kwh"],
                estimated_consumption_kwh=sched["consumption_kwh"],
                surplus_kwh=sched["surplus_kwh"],
                battery_action=sched["battery_action"],
                grid_export_kwh=sched.get("grid_export_kwh", 0.0),
                battery_charge_kwh=sched["battery_charge_kwh"],
                battery_soc_percent=sched["battery_soc_percent"],
            ))

        # Determine data source for transparency
        weather_source = weather.get("data_source", "Open-Meteo (Best Match)")
        ml_model = predictor.last_used_model
        if weather_source == "estimated" and ml_model != "Physics-Based Estimation":
            ml_model += " (with Estimated Weather)"

        return PredictionResponse(
            location={
                "latitude": user_input.latitude,
                "longitude": user_input.longitude,
                "timezone": weather.get("timezone", "UTC"),
            },
            system_info={
                "panel_capacity_kw": user_input.solar_panel_capacity_kw,
                "battery_capacity_kwh": user_input.battery_capacity_kwh,
                "panel_age_years": user_input.panel_age_years,
                "battery_age_years": user_input.battery_age_years,
                "current_charge_percent": user_input.current_battery_charge,
                "panel_tilt_deg": user_input.tilt_deg,
                "panel_azimuth_deg": user_input.azimuth_deg,
            },
            hourly_forecast=hourly_forecast,
            daily_summary=battery_result["daily_summary"],
            recommendations=battery_result["recommendations"],
            model_used=ml_model,
            weather_data_source=weather_source,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")
