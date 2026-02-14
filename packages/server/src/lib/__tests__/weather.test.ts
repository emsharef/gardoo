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
    relative_humidity_2m: "%",
    wind_speed_10m: "km/h",
    weather_code: "wmo code",
  },
  current: {
    temperature_2m: 22.5,
    relative_humidity_2m: 65,
    wind_speed_10m: 12.3,
    weather_code: 1,
  },
  daily_units: {
    temperature_2m_max: "\u00b0C",
    temperature_2m_min: "\u00b0C",
    precipitation_probability_max: "%",
    weather_code: "wmo code",
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
    precipitation_probability_max: [10, 30, 60, 80, 45, 20, 15],
    weather_code: [0, 1, 3, 61, 2, 0, 1],
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
    expect(result.current.humidity).toBe(65);
    expect(result.current.windSpeed).toBe(12.3);
    expect(result.current.weatherCode).toBe(1);
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
    expect(firstDay.precipitationProbability).toBe(10);
    expect(firstDay.weatherCode).toBe(0);

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
    expect(calledUrl.searchParams.get("daily")).toContain(
      "temperature_2m_max",
    );
  });
});
