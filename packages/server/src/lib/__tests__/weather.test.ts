import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWeather } from "../weather.js";

const MOCK_RESPONSE = {
  latitude: 40.71,
  longitude: -74.01,
  generationtime_ms: 0.5,
  utc_offset_seconds: -18000,
  timezone: "America/New_York",
  current_units: {
    temperature_2m: "\u00b0C",
    apparent_temperature: "\u00b0C",
    relative_humidity_2m: "%",
    wind_speed_10m: "km/h",
    wind_gusts_10m: "km/h",
    weather_code: "wmo code",
    uv_index: "",
    dew_point_2m: "\u00b0C",
    soil_temperature_0cm: "\u00b0C",
    soil_temperature_6cm: "\u00b0C",
    soil_moisture_0_to_1cm: "m\u00b3/m\u00b3",
  },
  current: {
    temperature_2m: 22.5,
    apparent_temperature: 21.0,
    relative_humidity_2m: 65,
    wind_speed_10m: 12.3,
    wind_gusts_10m: 25.1,
    weather_code: 1,
    uv_index: 5.2,
    dew_point_2m: 15.3,
    soil_temperature_0cm: 18.4,
    soil_temperature_6cm: 16.7,
    soil_moisture_0_to_1cm: 0.32,
  },
  daily_units: {
    temperature_2m_max: "\u00b0C",
    temperature_2m_min: "\u00b0C",
    apparent_temperature_max: "\u00b0C",
    apparent_temperature_min: "\u00b0C",
    precipitation_sum: "mm",
    precipitation_probability_max: "%",
    weather_code: "wmo code",
    sunrise: "iso8601",
    sunset: "iso8601",
    uv_index_max: "",
    wind_gusts_10m_max: "km/h",
    et0_fao_evapotranspiration: "mm",
    shortwave_radiation_sum: "MJ/m\u00b2",
  },
  daily: {
    time: [
      "2026-02-14",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
      "2026-02-20",
    ],
    temperature_2m_max: [25.0, 23.1, 20.5, 18.9, 22.0, 24.3, 21.7],
    temperature_2m_min: [14.2, 13.0, 11.5, 10.1, 12.8, 15.0, 13.3],
    apparent_temperature_max: [26.1, 24.0, 21.2, 19.5, 23.1, 25.0, 22.3],
    apparent_temperature_min: [13.0, 11.8, 10.2, 8.9, 11.5, 13.8, 12.0],
    precipitation_sum: [0.0, 1.2, 5.8, 12.4, 3.1, 0.5, 0.0],
    precipitation_probability_max: [10, 30, 60, 80, 45, 20, 15],
    weather_code: [0, 1, 3, 61, 2, 0, 1],
    sunrise: [
      "2026-02-14T06:52",
      "2026-02-15T06:51",
      "2026-02-16T06:50",
      "2026-02-17T06:49",
      "2026-02-18T06:48",
      "2026-02-19T06:46",
      "2026-02-20T06:45",
    ],
    sunset: [
      "2026-02-14T17:28",
      "2026-02-15T17:29",
      "2026-02-16T17:30",
      "2026-02-17T17:32",
      "2026-02-18T17:33",
      "2026-02-19T17:34",
      "2026-02-20T17:35",
    ],
    uv_index_max: [4.5, 3.8, 2.1, 1.5, 3.2, 5.0, 4.1],
    wind_gusts_10m_max: [35.2, 28.1, 42.5, 55.3, 30.0, 22.4, 26.8],
    et0_fao_evapotranspiration: [2.1, 1.8, 1.2, 0.9, 1.5, 2.3, 1.9],
    shortwave_radiation_sum: [15.2, 12.8, 8.5, 5.2, 11.0, 16.1, 13.5],
  },
};

describe("fetchWeather", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("successfully parses a valid Open-Meteo response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });

    const result = await fetchWeather(40.71, -74.01);

    expect(result.current).toBeDefined();
    expect(result.daily).toBeDefined();
    expect(result.daily).toHaveLength(7);
  });

  it("throws on non-200 API response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchWeather(40.71, -74.01)).rejects.toThrow(
      "Weather API error: 500",
    );
  });

  it("correctly maps current weather fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });

    const result = await fetchWeather(40.71, -74.01);

    expect(result.current.temperature).toBe(22.5);
    expect(result.current.apparentTemperature).toBe(21.0);
    expect(result.current.humidity).toBe(65);
    expect(result.current.windSpeed).toBe(12.3);
    expect(result.current.windGusts).toBe(25.1);
    expect(result.current.weatherCode).toBe(1);
    expect(result.current.uvIndex).toBe(5.2);
    expect(result.current.dewPoint).toBe(15.3);
    expect(result.current.soilTemperature0cm).toBe(18.4);
    expect(result.current.soilTemperature6cm).toBe(16.7);
    expect(result.current.soilMoisture).toBe(0.32);
  });

  it("correctly maps daily forecast fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });

    const result = await fetchWeather(40.71, -74.01);

    const firstDay = result.daily[0];
    expect(firstDay.date).toBe("2026-02-14");
    expect(firstDay.tempMax).toBe(25.0);
    expect(firstDay.tempMin).toBe(14.2);
    expect(firstDay.apparentTempMax).toBe(26.1);
    expect(firstDay.apparentTempMin).toBe(13.0);
    expect(firstDay.precipitationSum).toBe(0.0);
    expect(firstDay.precipitationProbability).toBe(10);
    expect(firstDay.weatherCode).toBe(0);
    expect(firstDay.sunrise).toBe("2026-02-14T06:52");
    expect(firstDay.sunset).toBe("2026-02-14T17:28");
    expect(firstDay.uvIndexMax).toBe(4.5);
    expect(firstDay.windGustsMax).toBe(35.2);
    expect(firstDay.et0Evapotranspiration).toBe(2.1);
    expect(firstDay.shortwaveRadiationSum).toBe(15.2);

    const fourthDay = result.daily[3];
    expect(fourthDay.date).toBe("2026-02-17");
    expect(fourthDay.tempMax).toBe(18.9);
    expect(fourthDay.tempMin).toBe(10.1);
    expect(fourthDay.precipitationProbability).toBe(80);
    expect(fourthDay.weatherCode).toBe(61);
  });

  it("constructs the correct API URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });
    globalThis.fetch = mockFetch;

    await fetchWeather(51.5, -0.12);

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://api.open-meteo.com/v1/forecast",
    );
    expect(calledUrl.searchParams.get("latitude")).toBe("51.5");
    expect(calledUrl.searchParams.get("longitude")).toBe("-0.12");
    expect(calledUrl.searchParams.get("forecast_days")).toBe("7");
    expect(calledUrl.searchParams.get("timezone")).toBe("auto");
    expect(calledUrl.searchParams.get("current")).toContain("temperature_2m");
    expect(calledUrl.searchParams.get("current")).toContain("uv_index");
    expect(calledUrl.searchParams.get("current")).toContain(
      "soil_temperature_0cm",
    );
    expect(calledUrl.searchParams.get("daily")).toContain(
      "temperature_2m_max",
    );
    expect(calledUrl.searchParams.get("daily")).toContain("sunrise");
    expect(calledUrl.searchParams.get("daily")).toContain(
      "et0_fao_evapotranspiration",
    );
  });
});
