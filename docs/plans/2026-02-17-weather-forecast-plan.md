# Weather & Forecast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand weather data fetching with gardening-relevant metrics, fix the broken web weather card, and add a dedicated `/weather` forecast page.

**Architecture:** Expand the existing Open-Meteo fetch to pull UV, soil temp/moisture, ET0, sunrise/sunset, apparent temp, dew point, and wind gusts. Add a shared weather utility module for WMO code decoding, alert derivation, and formatting. Fix the home page card and build a new `/weather` page. No DB migration needed (JSONB cache).

**Tech Stack:** Open-Meteo API, Next.js App Router, Tailwind CSS, tRPC

---

### Task 1: Expand server weather data fetching

**Files:**
- Modify: `packages/server/src/lib/weather.ts`

**Step 1: Replace the WeatherData interface and fetchWeather function**

Replace the entire file with expanded types and API parameters:

```typescript
export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windGusts: number;
  weatherCode: number;
  uvIndex: number;
  dewPoint: number;
  soilTemperature0cm: number;
  soilTemperature6cm: number;
  soilMoisture: number;
}

export interface DailyForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  apparentTempMax: number;
  apparentTempMin: number;
  precipitationSum: number;
  precipitationProbability: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
  windGustsMax: number;
  et0Evapotranspiration: number;
  shortwaveRadiationSum: number;
}

export interface WeatherData {
  current: CurrentWeather;
  daily: DailyForecast[];
}

export async function fetchWeather(
  lat: number,
  lng: number,
): Promise<WeatherData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lng.toString());
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_gusts_10m",
      "weather_code",
      "uv_index",
      "dew_point_2m",
      "soil_temperature_0cm",
      "soil_temperature_6cm",
      "soil_moisture_0_to_1cm",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "weather_code",
      "sunrise",
      "sunset",
      "uv_index_max",
      "wind_gusts_10m_max",
      "et0_fao_evapotranspiration",
      "shortwave_radiation_sum",
    ].join(","),
  );
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const data = await res.json();

  return {
    current: {
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      windGusts: data.current.wind_gusts_10m,
      weatherCode: data.current.weather_code,
      uvIndex: data.current.uv_index,
      dewPoint: data.current.dew_point_2m,
      soilTemperature0cm: data.current.soil_temperature_0cm,
      soilTemperature6cm: data.current.soil_temperature_6cm,
      soilMoisture: data.current.soil_moisture_0_to_1cm,
    },
    daily: data.daily.time.map((date: string, i: number) => ({
      date,
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
      apparentTempMax: data.daily.apparent_temperature_max[i],
      apparentTempMin: data.daily.apparent_temperature_min[i],
      precipitationSum: data.daily.precipitation_sum[i],
      precipitationProbability: data.daily.precipitation_probability_max[i],
      weatherCode: data.daily.weather_code[i],
      sunrise: data.daily.sunrise[i],
      sunset: data.daily.sunset[i],
      uvIndexMax: data.daily.uv_index_max[i],
      windGustsMax: data.daily.wind_gusts_10m_max[i],
      et0Evapotranspiration: data.daily.et0_fao_evapotranspiration[i],
      shortwaveRadiationSum: data.daily.shortwave_radiation_sum[i],
    })),
  };
}
```

**Step 2: Run server typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: PASS (the WeatherData type is stored as JSONB so the expanded shape is fine; the `contextBuilder.ts` casts it as `Record<string, unknown>` so no breakage)

**Step 3: Commit**

```bash
git add packages/server/src/lib/weather.ts
git commit -m "feat: expand weather data with gardening metrics (UV, soil, ET0, sunrise/sunset)"
```

---

### Task 2: Create shared web weather utilities

**Files:**
- Create: `packages/web/src/lib/weather.ts`

**Step 1: Create the utility file**

This module provides WMO code decoding, weather icons, alert derivation, and formatting. Used by both the home page card and the `/weather` page.

```typescript
export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windGusts: number;
  weatherCode: number;
  uvIndex: number;
  dewPoint: number;
  soilTemperature0cm: number;
  soilTemperature6cm: number;
  soilMoisture: number;
}

export interface DailyForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  apparentTempMax: number;
  apparentTempMin: number;
  precipitationSum: number;
  precipitationProbability: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
  windGustsMax: number;
  et0Evapotranspiration: number;
  shortwaveRadiationSum: number;
}

export interface WeatherData {
  current: CurrentWeather;
  daily: DailyForecast[];
}

export interface WeatherAlert {
  type: "frost" | "high_uv" | "heavy_rain" | "high_wind";
  label: string;
  detail: string;
  color: string;
}

/** Map WMO weather codes to human-readable conditions */
export function weatherCodeToCondition(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 49) return "Fog";
  if (code <= 55) return "Drizzle";
  if (code <= 59) return "Freezing drizzle";
  if (code <= 65) return "Rain";
  if (code <= 69) return "Freezing rain";
  if (code <= 75) return "Snowfall";
  if (code <= 79) return "Snow grains";
  if (code <= 84) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code <= 99) return "Thunderstorm with hail";
  return "Unknown";
}

/** Get an emoji icon for a WMO weather code */
export function weatherCodeToIcon(code: number): string {
  if (code === 0) return "\u2600\uFE0F"; // sunny
  if (code <= 3) return "\u26C5"; // partly cloudy
  if (code <= 49) return "\uD83C\uDF2B\uFE0F"; // fog
  if (code <= 59) return "\uD83C\uDF27\uFE0F"; // drizzle
  if (code <= 69) return "\uD83C\uDF27\uFE0F"; // rain
  if (code <= 79) return "\u2744\uFE0F"; // snow
  if (code <= 86) return "\uD83C\uDF28\uFE0F"; // snow showers
  if (code <= 99) return "\u26C8\uFE0F"; // thunderstorm
  return "\u2601\uFE0F"; // cloud default
}

/** Derive gardening-relevant alerts from forecast data */
export function deriveAlerts(daily: DailyForecast[]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  for (const day of daily) {
    if (day.tempMin <= 2) {
      alerts.push({
        type: "frost",
        label: "Frost risk",
        detail: `${formatDayName(day.date)}: Low of ${Math.round(day.tempMin)}°C`,
        color: "bg-blue-100 text-blue-800 border-blue-200",
      });
      break; // one frost alert is enough
    }
  }

  for (const day of daily) {
    if (day.uvIndexMax >= 8) {
      alerts.push({
        type: "high_uv",
        label: "High UV",
        detail: `${formatDayName(day.date)}: UV index ${Math.round(day.uvIndexMax)}`,
        color: "bg-orange-100 text-orange-800 border-orange-200",
      });
      break;
    }
  }

  for (const day of daily) {
    if (day.precipitationSum > 10) {
      alerts.push({
        type: "heavy_rain",
        label: "Heavy rain",
        detail: `${formatDayName(day.date)}: ${day.precipitationSum.toFixed(1)}mm expected`,
        color: "bg-cyan-100 text-cyan-800 border-cyan-200",
      });
      break;
    }
  }

  for (const day of daily) {
    if (day.windGustsMax > 50) {
      alerts.push({
        type: "high_wind",
        label: "High wind",
        detail: `${formatDayName(day.date)}: Gusts up to ${Math.round(day.windGustsMax)} km/h`,
        color: "bg-amber-100 text-amber-800 border-amber-200",
      });
      break;
    }
  }

  return alerts;
}

/** Format a date string as short day name (e.g., "Mon", "Tue") */
export function formatDayName(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

/** Format sunrise/sunset ISO string to local time (e.g., "6:42 AM") */
export function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Parse the JSONB forecast blob from the weather cache into typed data */
export function parseWeatherData(
  forecast: unknown,
): WeatherData | null {
  const data = forecast as Record<string, unknown> | null;
  if (!data?.current || !data?.daily) return null;
  return data as unknown as WeatherData;
}
```

**Step 2: Verify web build**

Run: `pnpm --filter @gardoo/web build`
Expected: PASS (new file, not imported yet)

**Step 3: Commit**

```bash
git add packages/web/src/lib/weather.ts
git commit -m "feat: add shared weather utilities (WMO codes, alerts, formatting)"
```

---

### Task 3: Fix and enhance the home page weather card

**Files:**
- Modify: `packages/web/src/app/page.tsx`

**Step 1: Replace the broken weather card**

Replace the weather card section (lines 63-107) in `page.tsx`. Import the weather utilities at the top:

```typescript
import {
  parseWeatherData,
  weatherCodeToCondition,
  weatherCodeToIcon,
  deriveAlerts,
} from "@/lib/weather";
```

Replace the line:
```typescript
const forecast = weather?.forecast as Record<string, unknown> | null;
```

With:
```typescript
const weatherData = parseWeatherData(weather?.forecast);
const alerts = weatherData ? deriveAlerts(weatherData.daily) : [];
```

Replace the weather card JSX (the `<div className="rounded-xl border border-gray-200 bg-white p-5">` block, lines 70-107) with:

```tsx
<div className="rounded-xl border border-gray-200 bg-white p-5">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
      Weather
    </h2>
    {weatherData && (
      <a
        href="/weather"
        className="text-sm font-medium text-[#2D7D46] hover:underline"
      >
        Full forecast &rarr;
      </a>
    )}
  </div>
  {!gardenId ? (
    <p className="text-sm text-gray-400">
      No garden found. Create one in settings.
    </p>
  ) : weatherQuery.isLoading ? (
    <div className="h-12 animate-pulse rounded bg-gray-100" />
  ) : weatherData ? (
    <div className="space-y-3">
      {/* Current conditions */}
      <div className="flex items-center gap-4">
        <span className="text-4xl">
          {weatherCodeToIcon(weatherData.current.weatherCode)}
        </span>
        <div>
          <p className="text-3xl font-bold text-gray-900">
            {Math.round(weatherData.current.temperature)}°C
          </p>
          <p className="text-sm text-gray-500">
            Feels like {Math.round(weatherData.current.apparentTemperature)}°C
            &middot; {weatherCodeToCondition(weatherData.current.weatherCode)}
          </p>
        </div>
        <div className="ml-auto text-right text-sm text-gray-500">
          <p>H: {Math.round(weatherData.daily[0]?.tempMax ?? 0)}° L: {Math.round(weatherData.daily[0]?.tempMin ?? 0)}°</p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600 sm:grid-cols-4">
        <p>Humidity: {weatherData.current.humidity}%</p>
        <p>UV: {Math.round(weatherData.current.uvIndex)}</p>
        <p>Wind: {Math.round(weatherData.current.windSpeed)} km/h</p>
        <p>Dew point: {Math.round(weatherData.current.dewPoint)}°C</p>
        <p>Soil temp: {Math.round(weatherData.current.soilTemperature0cm)}°C</p>
        <p>Soil moisture: {(weatherData.current.soilMoisture * 100).toFixed(0)}%</p>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {alerts.map((alert) => (
            <span
              key={alert.type}
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${alert.color}`}
              title={alert.detail}
            >
              {alert.label}
            </span>
          ))}
        </div>
      )}
    </div>
  ) : (
    <p className="text-sm text-gray-400">
      No weather data available yet. Run an analysis or wait for the daily job.
    </p>
  )}
</div>
```

**Step 2: Verify web build**

Run: `pnpm --filter @gardoo/web build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/web/src/app/page.tsx
git commit -m "fix: replace broken weather card with working enhanced display"
```

---

### Task 4: Add Weather nav link

**Files:**
- Modify: `packages/web/src/components/Navigation.tsx`

**Step 1: Add WeatherIcon function and nav item**

Add a `WeatherIcon` component after the existing icon functions (before `LogoutIcon`):

```typescript
function WeatherIcon({ active }: { active?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#2D7D46" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
```

Then add the Weather item to the `navItems` array, between Analysis and Calendar:

```typescript
const navItems = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/garden", label: "Garden", icon: GardenIcon },
  { href: "/analysis", label: "Analysis", icon: AnalysisIcon },
  { href: "/weather", label: "Weather", icon: WeatherIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];
```

**Step 2: Verify web build**

Run: `pnpm --filter @gardoo/web build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/web/src/components/Navigation.tsx
git commit -m "feat: add Weather link to navigation sidebar"
```

---

### Task 5: Create the dedicated /weather page

**Files:**
- Create: `packages/web/src/app/weather/page.tsx`

**Step 1: Create the weather page**

This is the richest piece — a full forecast page with current conditions, 7-day forecast cards, and gardening alerts.

```tsx
"use client";

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import {
  parseWeatherData,
  weatherCodeToCondition,
  weatherCodeToIcon,
  deriveAlerts,
  formatDayName,
  formatTime,
} from "@/lib/weather";
import type { WeatherAlert, DailyForecast } from "@/lib/weather";

export default function WeatherPage() {
  const { isAuthenticated } = useAuth();
  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const gardenId = gardensQuery.data?.[0]?.id;

  const weatherQuery = trpc.gardens.getWeather.useQuery(
    { gardenId: gardenId! },
    { enabled: !!gardenId },
  );

  if (!isAuthenticated) return null;

  const weatherData = parseWeatherData(weatherQuery.data?.forecast);
  const alerts = weatherData ? deriveAlerts(weatherData.daily) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Weather & Forecast</h1>

      {!gardenId ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-400">No garden found. Create one in settings.</p>
        </div>
      ) : weatherQuery.isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : !weatherData ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-400">
            No weather data available yet. Run an analysis or wait for the daily job.
          </p>
        </div>
      ) : (
        <>
          {/* Current Conditions */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Current Conditions
            </h2>
            <div className="flex items-center gap-6">
              <span className="text-5xl">
                {weatherCodeToIcon(weatherData.current.weatherCode)}
              </span>
              <div>
                <p className="text-4xl font-bold text-gray-900">
                  {Math.round(weatherData.current.temperature)}°C
                </p>
                <p className="text-gray-500">
                  Feels like {Math.round(weatherData.current.apparentTemperature)}°C
                  &middot; {weatherCodeToCondition(weatherData.current.weatherCode)}
                </p>
              </div>
              {weatherData.daily[0] && (
                <div className="ml-auto text-right">
                  <p className="text-lg font-medium text-gray-700">
                    H: {Math.round(weatherData.daily[0].tempMax)}° L: {Math.round(weatherData.daily[0].tempMin)}°
                  </p>
                  <p className="text-sm text-gray-500">
                    Sunrise {formatTime(weatherData.daily[0].sunrise)} &middot; Sunset {formatTime(weatherData.daily[0].sunset)}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 border-t border-gray-100 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <MetricItem label="Humidity" value={`${weatherData.current.humidity}%`} />
              <MetricItem label="UV Index" value={String(Math.round(weatherData.current.uvIndex))} />
              <MetricItem label="Wind Speed" value={`${Math.round(weatherData.current.windSpeed)} km/h`} />
              <MetricItem label="Wind Gusts" value={`${Math.round(weatherData.current.windGusts)} km/h`} />
              <MetricItem label="Dew Point" value={`${Math.round(weatherData.current.dewPoint)}°C`} />
              <MetricItem label="Soil Temp (surface)" value={`${Math.round(weatherData.current.soilTemperature0cm)}°C`} />
              <MetricItem label="Soil Temp (6cm)" value={`${Math.round(weatherData.current.soilTemperature6cm)}°C`} />
              <MetricItem label="Soil Moisture" value={`${(weatherData.current.soilMoisture * 100).toFixed(0)}%`} />
            </div>
          </div>

          {/* Gardening Alerts */}
          {alerts.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Gardening Alerts
              </h2>
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <AlertRow key={alert.type} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {/* 7-Day Forecast */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              7-Day Forecast
            </h2>
            <div className="space-y-0 divide-y divide-gray-100">
              {weatherData.daily.map((day) => (
                <ForecastRow key={day.date} day={day} />
              ))}
            </div>
          </div>

          {/* Watering Guidance */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Watering Guidance
            </h2>
            <WateringGuidance daily={weatherData.daily} />
          </div>
        </>
      )}
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="font-medium text-gray-700">{value}</p>
    </div>
  );
}

function AlertRow({ alert }: { alert: WeatherAlert }) {
  const icons: Record<string, string> = {
    frost: "\u2744\uFE0F",
    high_uv: "\u2600\uFE0F",
    heavy_rain: "\uD83C\uDF27\uFE0F",
    high_wind: "\uD83D\uDCA8",
  };
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${alert.color}`}>
      <span className="text-lg">{icons[alert.type]}</span>
      <div>
        <p className="font-medium">{alert.label}</p>
        <p className="text-sm opacity-80">{alert.detail}</p>
      </div>
    </div>
  );
}

function ForecastRow({ day }: { day: DailyForecast }) {
  return (
    <div className="grid grid-cols-[80px_40px_1fr_auto] items-center gap-4 py-3 sm:grid-cols-[80px_40px_1fr_repeat(4,auto)]">
      <p className="font-medium text-gray-900">{formatDayName(day.date)}</p>
      <span className="text-xl">{weatherCodeToIcon(day.weatherCode)}</span>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">{Math.round(day.tempMax)}°</span>
        <div className="hidden h-1.5 flex-1 rounded-full bg-gray-100 sm:block">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-blue-400 to-orange-400"
            style={{ width: `${Math.min(100, Math.max(10, ((day.tempMax - day.tempMin) / 30) * 100))}%` }}
          />
        </div>
        <span className="text-gray-400">{Math.round(day.tempMin)}°</span>
      </div>
      <p className="hidden text-sm text-gray-500 sm:block" title="Precipitation">
        {day.precipitationProbability}% &middot; {day.precipitationSum.toFixed(1)}mm
      </p>
      <p className="hidden text-sm text-gray-500 sm:block" title="UV Index">
        UV {Math.round(day.uvIndexMax)}
      </p>
      <p className="hidden text-sm text-gray-500 sm:block" title="Wind Gusts">
        {Math.round(day.windGustsMax)} km/h
      </p>
      <p className="hidden text-sm text-gray-500 sm:block" title="Sunrise / Sunset">
        {formatTime(day.sunrise)} / {formatTime(day.sunset)}
      </p>
    </div>
  );
}

function WateringGuidance({ daily }: { daily: DailyForecast[] }) {
  const next3Days = daily.slice(0, 3);
  const totalPrecip = next3Days.reduce((sum, d) => sum + d.precipitationSum, 0);
  const totalET0 = next3Days.reduce((sum, d) => sum + d.et0Evapotranspiration, 0);
  const waterDeficit = totalET0 - totalPrecip;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-xs text-gray-400">3-Day Rainfall</p>
          <p className="text-lg font-bold text-cyan-600">{totalPrecip.toFixed(1)}mm</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">3-Day ET₀</p>
          <p className="text-lg font-bold text-orange-600">{totalET0.toFixed(1)}mm</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Water Deficit</p>
          <p className={`text-lg font-bold ${waterDeficit > 0 ? "text-red-600" : "text-green-600"}`}>
            {waterDeficit > 0 ? "+" : ""}{waterDeficit.toFixed(1)}mm
          </p>
        </div>
      </div>
      <p className="text-sm text-gray-600">
        {waterDeficit > 5
          ? "Plants will likely need supplemental watering in the next 3 days. Evapotranspiration significantly exceeds expected rainfall."
          : waterDeficit > 0
            ? "Mild water deficit expected. Monitor soil moisture and water if plants show stress."
            : "Rainfall should cover water needs for the next 3 days. Avoid overwatering."}
      </p>
    </div>
  );
}
```

**Step 2: Verify web build**

Run: `pnpm --filter @gardoo/web build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/web/src/app/weather/page.tsx
git commit -m "feat: add dedicated /weather page with forecast, alerts, and watering guidance"
```

---

### Task 6: Final verification and push

**Step 1: Run server typecheck**

Run: `pnpm --filter @gardoo/server typecheck`
Expected: PASS

**Step 2: Run web build**

Run: `pnpm --filter @gardoo/web build`
Expected: PASS

**Step 3: Push to remote**

```bash
git push -u origin feature/weather-forecast
```
