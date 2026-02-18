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
          <p className="text-xs text-gray-400">3-Day ET&#x2080;</p>
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
