# Weather & Forecast Feature Design

## Problem

Weather infrastructure exists (Open-Meteo fetch, caching, AI context) but:
1. Web weather card uses wrong field names (`temp_f`, `condition`) — nothing displays
2. Data is minimal — only basic temp/humidity/wind/precip, missing gardening-relevant metrics
3. No dedicated forecast view — just a small card on the home page

## Design

### Enhanced Weather Data

Expand `fetchWeather()` to pull gardening-relevant metrics from Open-Meteo.

**Current conditions** (from hourly endpoint, latest value):
- temperature, apparent_temperature, humidity, wind_speed, wind_gusts
- uv_index, dew_point
- soil_temperature_0cm, soil_temperature_6cm
- soil_moisture_0_to_1cm
- weather_code

**Daily forecast** (7 days):
- temperature_2m_max, temperature_2m_min
- apparent_temperature_max, apparent_temperature_min
- precipitation_sum, precipitation_probability_max
- sunrise, sunset
- uv_index_max
- wind_gusts_10m_max
- et0_fao_evapotranspiration
- shortwave_radiation_sum
- weather_code

**Derived gardening alerts** (computed from forecast data):
- Frost risk: min temp ≤ 2°C
- High UV: UV index ≥ 8
- Heavy rain: precipitation sum > 10mm
- High wind: gusts > 50 km/h

No schema migration needed — `weather_cache.forecast` is JSONB and accepts the expanded structure.

### Web UI: Enhanced Home Page Weather Card

Replace the broken card on `/` with:
- Current conditions: weather icon + temperature + "Feels like X°" + condition text
- Key metrics: humidity, UV index, wind, dew point, soil temp
- Today's range: high/low temps
- Alert badges: frost, high UV, heavy rain — color-coded
- "View full forecast →" link to `/weather`

### Web UI: Dedicated `/weather` Page

New page at `packages/web/src/app/weather/page.tsx`:
- Current conditions panel (expanded): all current metrics including soil moisture, ET0
- 7-day forecast cards: icon, high/low, precip %, sunrise/sunset, UV, wind gusts per day
- Gardening alerts section: frost risk days highlighted, watering guidance from ET0 + precip, UV warnings
- Sunrise/sunset times

### Navigation

Add "Weather" link to the web app navigation bar.

### Mobile

No changes — mobile WeatherHeader already works correctly with the existing data structure. The expanded data will be available if mobile wants to use it later.

## Files

| File | Action |
|------|--------|
| `packages/server/src/lib/weather.ts` | Expand WeatherData interface + API params |
| `packages/web/src/app/page.tsx` | Fix and enhance weather card |
| `packages/web/src/app/weather/page.tsx` | New dedicated weather page |
| `packages/web/src/components/Navigation.tsx` | Add Weather nav link |
| `packages/web/src/lib/weather.ts` | New shared weather utilities (WMO codes, alert logic, formatting) |
