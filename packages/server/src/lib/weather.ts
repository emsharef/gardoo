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
