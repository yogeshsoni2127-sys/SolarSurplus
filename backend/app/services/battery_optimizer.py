"""
Battery Optimizer Service.

Calculates surplus energy, manages battery charge/discharge schedule,
and generates usage recommendations based on forecast data.
"""


# Named hourly consumption patterns. Each list has 24 weights (hours 0-23,
# India local time) representing the relative draw of that hour; weights are
# normalised to sum to 1.0 so `avg_daily_consumption_kwh` just scales them.
CONSUMPTION_PROFILES = {
    "default": [
        0.02, 0.02, 0.02, 0.02, 0.02, 0.03,  # 0-5 (night)
        0.05, 0.06, 0.06, 0.05, 0.04, 0.04,  # 6-11 (morning)
        0.04, 0.04, 0.04, 0.04, 0.05, 0.06,  # 12-17 (afternoon)
        0.07, 0.07, 0.06, 0.05, 0.04, 0.03,  # 18-23 (evening)
    ],
    "working_9_5": [
        0.015, 0.014, 0.013, 0.012, 0.013, 0.02,  # 0-5
        0.045, 0.054, 0.04, 0.025, 0.022, 0.02,   # 6-11 (small morning spike, out for the day)
        0.02, 0.02, 0.02, 0.02, 0.03, 0.06,       # 12-17 (low daytime) -> evening commute
        0.098, 0.092, 0.075, 0.05, 0.03, 0.02,    # 18-23 (steep evening peak)
    ],
    "home_all_day": [
        0.035, 0.032, 0.03, 0.028, 0.03, 0.035,   # 0-5
        0.05, 0.06, 0.055, 0.05, 0.045, 0.045,    # 6-11
        0.045, 0.045, 0.045, 0.045, 0.05, 0.06,   # 12-17
        0.065, 0.06, 0.05, 0.04, 0.035, 0.03,     # 18-23
    ],
    "night_shift": [
        0.045, 0.05, 0.055, 0.06, 0.055, 0.045,   # 0-5 (peak at night)
        0.04, 0.035, 0.03, 0.025, 0.025, 0.03,    # 6-11 (sleeping by day)
        0.035, 0.035, 0.04, 0.04, 0.045, 0.05,    # 12-17
        0.05, 0.045, 0.04, 0.04, 0.045, 0.05,     # 18-23
    ],
    "ac_heavy": [
        0.015, 0.014, 0.013, 0.012, 0.013, 0.015,  # 0-5
        0.04, 0.045, 0.04, 0.035, 0.04, 0.05,      # 6-11
        0.06, 0.065, 0.07, 0.075, 0.08, 0.085,     # 12-17 (early-start AC, afternoon peak)
        0.085, 0.075, 0.06, 0.045, 0.03, 0.02,     # 18-23 (evening cooling)
    ],
    "elderly_home": [
        0.02, 0.02, 0.02, 0.02, 0.02, 0.03,        # 0-5
        0.05, 0.06, 0.06, 0.06, 0.05, 0.045,       # 6-11 (early rise, midday
        0.04, 0.04, 0.04, 0.04, 0.05, 0.06,        # 12-17
        0.07, 0.07, 0.06, 0.05, 0.04, 0.03,        # 18-23
    ],
}

_NORMALISED_PROFILES = {
    key: [w / sum(weights) for w in weights]
    for key, weights in CONSUMPTION_PROFILES.items()
}


# ── Battery state-of-health model ──────────────────────────────────────
# Health = calendar aging (time + temperature) + cycle aging
# (cycles/yr × depth-of-discharge), chemistry aware. Degradation roughly
# doubles every 10 °C above 25 °C (Arrhenius rule of thumb).
BATTERY_CHEMISTRY = {
    # cycle_life_eq: equivalent full cycles to reach 80% SOH (EOL)
    # calendar_rate_pct_yr: % capacity lost per year from sitting at float
    "lead_acid": {"cycle_life_eq": 1200, "calendar_rate_pct_yr": 0.025},
    "lithium":   {"cycle_life_eq": 4500, "calendar_rate_pct_yr": 0.015},
}

BATTERY_DRAIN = {
    # cycles_yr + typical depth-of-discharge per cycle
    "heavy":    {"cycles_yr": 350, "dod": 0.85},
    "moderate": {"cycles_yr": 200, "dod": 0.55},
    "light":    {"cycles_yr": 40,  "dod": 0.30},
}

BATTERY_PLACEMENT_TEMP = {
    "indoor":  27.5,  # shaded room ~25-30 °C
    "outdoor": 38.0,  # exposed rooftop / balcony
}

EOL_SOH = 0.80      # end-of-life for the cycle-life model
SOIL_FLOOR = 0.50   # never let health fall below this (battery would be replaced)
THERMAL_REF = 25.0  # °C


def calculate_battery_health(
    age_years: float,
    battery_type: str = "unknown",
    drain_frequency: str = "moderate",
    placement: str = "indoor",
) -> dict:
    """
    Estimate battery state-of-health (%) from age, chemistry, cycling depth
    and ambient temperature.

    battery_type:  "lead_acid" (incl. tall tubular) | "lithium" | "unknown"
    drain_frequency: "heavy" | "moderate" | "light"
    placement:     "indoor" | "outdoor"

    Returns dict with health_percent, degradation_factor (fraction of rated
    capacity retained), plus the model factors used.
    """
    chem = BATTERY_CHEMISTRY.get(battery_type)
    if chem is None:
        chem = BATTERY_CHEMISTRY["lead_acid"]  # conservative for "unknown"
    drain = BATTERY_DRAIN.get(drain_frequency, BATTERY_DRAIN["moderate"])
    temp_c = BATTERY_PLACEMENT_TEMP.get(placement, BATTERY_PLACEMENT_TEMP["indoor"])

    temp_factor = 2.0 ** ((temp_c - THERMAL_REF) / 10.0)

    eq_cycles_yr = drain["cycles_yr"] * (drain["dod"] ** 1.1)
    cycle_loss_yr = eq_cycles_yr * (1.0 - EOL_SOH) / chem["cycle_life_eq"]
    cal_loss_yr = chem["calendar_rate_pct_yr"]

    annual_loss = (cycle_loss_yr + cal_loss_yr) * temp_factor
    total_loss = annual_loss * max(0.0, age_years)

    health = max(SOIL_FLOOR, min(1.0, 1.0 - total_loss))

    return {
        "health_percent": round(health * 100, 1),
        "degradation_factor": round(health, 4),
        "temperature_c": round(temp_c, 1),
        "temp_factor": round(temp_factor, 2),
        "eq_cycles_per_yr": round(eq_cycles_yr, 1),
        "cycle_loss_per_yr": round(cycle_loss_yr, 5),
        "calendar_loss_per_yr": round(cal_loss_yr, 5),
        "annual_loss": round(annual_loss, 5),
        "chemistry": "lithium" if battery_type == "lithium" else "lead_acid",
    }


def calculate_battery_schedule(
    hourly_generation: list[float],
    avg_daily_consumption_kwh: float,
    battery_capacity_kwh: float,
    current_charge_percent: float,
    battery_age_years: float = 0,
    language: str = "en",
    consumer_profile: str = "default",
    battery_type: str = "unknown",
    drain_frequency: str = "moderate",
    battery_placement: str = "indoor",
) -> dict:
    """
    Calculate optimal battery charge/discharge schedule.

    Logic:
    - Distribute daily consumption across hours using the selected
      lifestyle profile (weights by time of day)
    - When generation > consumption → surplus → charge battery
    - When generation < consumption → deficit → discharge battery
    - Respect battery limits: min 20% SoC, max 100% SoC

    Args:
        hourly_generation: Predicted kWh per hour
        avg_daily_consumption_kwh: Average daily consumption in kWh
        battery_capacity_kwh: Rated battery capacity in kWh
        current_charge_percent: Current SoC (0-100%)
        battery_age_years: Battery age for degradation calculation
        language: Output language for recommendations ('en' or 'hi')
        consumer_profile: Which hourly consumption shape to use
            (see CONSUMPTION_PROFILES)
        battery_type: Chemistry ("lead_acid" | "lithium" | "unknown")
        drain_frequency: Cycling load ("heavy" | "moderate" | "light")
        battery_placement: Ambient heat ("indoor" | "outdoor")

    Returns:
        Dict with hourly schedule, summary, and recommendations
    """
    # Battery state-of-health from age + chemistry + cycling depth + heat.
    health = calculate_battery_health(
        battery_age_years, battery_type, drain_frequency, battery_placement,
    )
    degradation_factor = health["degradation_factor"]
    usable_capacity = battery_capacity_kwh * degradation_factor

    # Minimum SoC to preserve battery health
    min_soc_percent = 20.0
    min_charge_kwh = usable_capacity * (min_soc_percent / 100)
    max_charge_kwh = usable_capacity

    # Current charge in kWh
    current_charge_kwh = usable_capacity * (current_charge_percent / 100)

    # Hourly consumption weights from the chosen lifestyle profile
    consumption_pattern = _NORMALISED_PROFILES.get(consumer_profile) or \
        _NORMALISED_PROFILES["default"]

    schedule = []
    charge_kwh = current_charge_kwh
    total_surplus = 0
    total_deficit = 0
    total_generated = 0
    total_consumed = 0
    total_grid_export = 0

    hours_in_forecast = len(hourly_generation)
    num_days = max(1, hours_in_forecast / 24)

    for i, gen_kwh in enumerate(hourly_generation):
        hour_of_day = i % 24

        # Estimated consumption for this hour
        consumption_kwh = avg_daily_consumption_kwh * consumption_pattern[hour_of_day]

        # Net energy balance
        net = gen_kwh - consumption_kwh
        surplus = max(0, net)
        deficit = max(0, -net)

        action = "idle"
        energy_flow = 0.0
        grid_export = 0.0

        if surplus > 0:
            # Charge battery with surplus (95% charging efficiency)
            charge_efficiency = 0.95
            can_charge = max_charge_kwh - charge_kwh
            actual_charge = min(surplus * charge_efficiency, can_charge)

            if actual_charge > 0.01:
                charge_kwh += actual_charge
                action = "charge"
                energy_flow = actual_charge
            # Surplus that can't be stored (battery full) → export to grid
            grid_export = max(0.0, surplus - actual_charge / charge_efficiency)
            total_grid_export += grid_export
            total_surplus += surplus

        elif deficit > 0:
            # Discharge battery to cover deficit (95% discharge efficiency)
            discharge_efficiency = 0.95
            available = (charge_kwh - min_charge_kwh) * discharge_efficiency
            actual_discharge = min(deficit, available)

            if actual_discharge > 0.01:
                charge_kwh -= actual_discharge / discharge_efficiency
                action = "discharge"
                energy_flow = actual_discharge
            total_deficit += deficit

        total_generated += gen_kwh
        total_consumed += consumption_kwh

        soc_percent = (charge_kwh / usable_capacity * 100) if usable_capacity > 0 else 0

        schedule.append({
            "hour_index": i,
            "hour_of_day": hour_of_day,
            "generation_kwh": round(gen_kwh, 3),
            "consumption_kwh": round(consumption_kwh, 3),
            "surplus_kwh": round(surplus, 3),
            "deficit_kwh": round(deficit, 3),
            "battery_action": action,
            "energy_flow_kwh": round(energy_flow, 3),
            "grid_export_kwh": round(grid_export, 3),
            "battery_charge_kwh": round(charge_kwh, 3),
            "battery_soc_percent": round(soc_percent, 1),
        })

    # Generate recommendations
    recommendations = _generate_recommendations(
        schedule, total_surplus, total_deficit,
        total_generated, total_consumed,
        usable_capacity, charge_kwh, num_days,
        total_grid_export, language, health["health_percent"],
    )

    # Daily summary
    daily_summary = {
        "total_generation_kwh": round(total_generated, 2),
        "total_consumption_kwh": round(total_consumed, 2),
        "total_surplus_kwh": round(total_surplus, 2),
        "total_deficit_kwh": round(total_deficit, 2),
        "grid_export_kwh": round(total_grid_export, 2),
        "net_energy_kwh": round(total_generated - total_consumed, 2),
        "self_sufficiency_percent": round(
            min(100, (total_generated / max(total_consumed, 0.01)) * 100), 1
        ),
        "final_battery_soc_percent": round(
            (charge_kwh / usable_capacity * 100) if usable_capacity > 0 else 0, 1
        ),
        "usable_battery_capacity_kwh": round(usable_capacity, 2),
        "battery_degradation_percent": round((1 - degradation_factor) * 100, 1),
        "battery_health_percent": health["health_percent"],
        "battery_health_temp_c": health["temperature_c"],
        "battery_chemistry": health["chemistry"],
        "battery_drain_cycles_yr": health["eq_cycles_per_yr"],
        "forecast_days": round(num_days, 1),
    }

    return {
        "schedule": schedule,
        "daily_summary": daily_summary,
        "recommendations": recommendations,
    }


def _generate_recommendations(
    schedule: list,
    total_surplus: float,
    total_deficit: float,
    total_generated: float,
    total_consumed: float,
    usable_capacity: float,
    final_charge: float,
    num_days: float,
    total_grid_export: float = 0.0,
    language: str = "en",
    battery_health_pct: float = 100.0,
) -> list[str]:
    """Generate actionable recommendations based on forecast. Supports hi/en."""
    hi = language.lower() == "hi"
    recs = []

    # Find peak generation hours
    gen_by_hour = {}
    for entry in schedule:
        h = entry["hour_of_day"]
        gen_by_hour.setdefault(h, []).append(entry["generation_kwh"])

    avg_gen_by_hour = {h: sum(v) / len(v) for h, v in gen_by_hour.items()}
    peak_hours = sorted(avg_gen_by_hour, key=avg_gen_by_hour.get, reverse=True)[:4]
    peak_start = min(peak_hours)
    peak_end = max(peak_hours)

    if hi:
        recs.append(
            f"☀️ चरम सौर उत्पादन: {peak_start}:00 – {peak_end}:00. "
            "उच्च-खपत वाले काम (वॉशिंग मशीन, AC) इन घंटों में करें।"
        )
    else:
        recs.append(
            f"☀️ Peak solar generation: {peak_start}:00 – {peak_end}:00. "
            "Schedule high-consumption tasks (washing, AC) during these hours."
        )

    # Find best battery discharge hours
    discharge_hours = [e["hour_of_day"] for e in schedule if e["battery_action"] == "discharge"]
    if discharge_hours:
        from collections import Counter
        common_discharge = Counter(discharge_hours).most_common(3)
        hours_str = ", ".join(f"{h}:00" for h, _ in common_discharge)
        if hi:
            recs.append(
                f"🔋 बैटरी पावर उपयोग के सर्वोत्तम समय: {hours_str}. "
                "इन अवधियों में बैटरी डिस्चार्ज होती है।"
            )
        else:
            recs.append(
                f"🔋 Best times to use battery power: {hours_str}. "
                "Battery discharges during these deficit hours."
            )

    # Self-sufficiency advice
    self_suff = (total_generated / max(total_consumed, 0.01)) * 100
    if self_suff >= 100:
        if hi:
            recs.append(
                f"✅ आपका सिस्टम आपकी खपत का {self_suff:.0f}% उत्पन्न करता है। "
                "आपके पास अधिशेष ऊर्जा है — नेट मीटरिंग या ग्रिड को बेचने पर विचार करें।"
            )
        else:
            recs.append(
                f"✅ Your system generates {self_suff:.0f}% of your consumption. "
                "You have surplus energy — consider net metering or selling back to the grid."
            )
    elif self_suff >= 70:
        if hi:
            recs.append(
                f"⚡ आपका सिस्टम खपत का {self_suff:.0f}% पूरा करता है। "
                "अच्छी आत्मनिर्भरता! बैटरी अंतर को पाटने में मदद करती है।"
            )
        else:
            recs.append(
                f"⚡ Your system covers {self_suff:.0f}% of consumption. "
                "Good self-sufficiency! Battery helps bridge the gap."
            )
    else:
        if hi:
            recs.append(
                f"⚠️ आपका सिस्टम केवल खपत का {self_suff:.0f}% पूरा करता है। "
                "सोलर पैनल क्षमता बढ़ाने या खपत घटाने पर विचार करें।"
            )
        else:
            recs.append(
                f"⚠️ Your system covers only {self_suff:.0f}% of consumption. "
                "Consider increasing solar panel capacity or reducing consumption."
            )

    # Battery sizing advice
    daily_surplus = total_surplus / max(num_days, 1)
    if daily_surplus > usable_capacity * 0.5:
        if hi:
            recs.append(
                f"📈 दैनिक अधिशेष ({daily_surplus:.1f} kWh) बैटरी क्षमता के 50% से अधिक है। "
                "बड़ी बैटरी अधिक मुफ्त ऊर्जा संग्रह कर सकती है।"
            )
        else:
            recs.append(
                f"📈 Daily surplus ({daily_surplus:.1f} kWh) exceeds 50% of battery capacity. "
                "A larger battery could capture more free energy."
            )

    # Net metering / grid export advice
    daily_export = total_grid_export / max(num_days, 1)
    if daily_export > 0.5:
        if hi:
            recs.append(
                f"🔌 आपके पास ~{daily_export:.1f} kWh/दिन निर्यात योग्य अधिशेष है "
                f"(₹3.00/kWh पर ≈₹{daily_export * 30 * 3.0:.0f}/माह)। "
                "इससे कमाई के लिए PM Surya Ghar के तहत नेट मीटरिंग में नामांकन करें।"
            )
        else:
            recs.append(
                f"🔌 You have ~{daily_export:.1f} kWh/day of exportable surplus "
                f"(≈₹{daily_export * 30 * 3.0:.0f}/month at ₹3.00/kWh). "
                "Enroll in net metering under PM Surya Ghar to earn from it."
            )

    # Battery state-of-health advice
    if battery_health_pct < 70:
        if hi:
            recs.append(
                f"🪫 आपकी बैटरी का स्वास्थ्य ~{battery_health_pct:.0f}% रह गया है। "
                "चक्रों की गहराई घटाएँ (डीप डिस्चार्ज से बचें) और गर्मी से दूर रखें; "
                "यदि स्वास्थ्य 70% से नीचे है तो बैटरी बदलने पर विचार करें।"
            )
        else:
            recs.append(
                f"🪫 Battery state-of-health is down to ~{battery_health_pct:.0f}%. "
                "Avoid deep discharges and keep it out of direct heat; "
                "consider replacement once health falls below 70%."
            )
    elif battery_health_pct >= 92:
        if hi:
            recs.append(
                f"🟢 बैटरी स्वास्थ्य ~{battery_health_pct:.0f}% — उत्कृष्ट। "
                "वर्तमान चार्जिंग प्रोफ़ाइल जारी रखें।"
            )
        else:
            recs.append(
                f"🟢 Battery health ~{battery_health_pct:.0f}% — excellent. "
                "Keep up the current charging profile."
            )

    return recs
