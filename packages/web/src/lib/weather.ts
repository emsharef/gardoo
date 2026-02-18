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
        detail: `${formatDayName(day.date)}: Low of ${Math.round(day.tempMin)}\u00B0C`,
        color: "bg-blue-100 text-blue-800 border-blue-200",
      });
      break;
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

export type Units = "metric" | "imperial";

/** Convert Celsius to Fahrenheit */
function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

/** Convert km/h to mph */
function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

/** Convert mm to inches */
function mmToIn(mm: number): number {
  return mm * 0.0393701;
}

/** Format a temperature value with unit */
export function fmtTemp(c: number, units: Units): string {
  if (units === "imperial") return `${Math.round(cToF(c))}°F`;
  return `${Math.round(c)}°C`;
}

/** Format a wind speed value with unit */
export function fmtWind(kmh: number, units: Units): string {
  if (units === "imperial") return `${Math.round(kmhToMph(kmh))} mph`;
  return `${Math.round(kmh)} km/h`;
}

/** Format a precipitation value with unit */
export function fmtPrecip(mm: number, units: Units): string {
  if (units === "imperial") return `${mmToIn(mm).toFixed(2)}in`;
  return `${mm.toFixed(1)}mm`;
}

/** Temperature unit label */
export function tempUnit(units: Units): string {
  return units === "imperial" ? "°F" : "°C";
}
