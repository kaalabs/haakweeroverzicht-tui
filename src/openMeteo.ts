import { addDaysYmd, latestAvailableHistoricYmd, yesterdayYmd, ymdMax } from "./date";
import type { City, WeatherDay } from "./db";

export type GeoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country?: string;
  admin1?: string;
};

export async function geocodeTopResult(query: string, signal?: AbortSignal): Promise<GeoResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status} ${res.statusText})`);
  }

  const json = (await res.json()) as unknown;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const first = results[0] as Record<string, unknown>;
  if (
    typeof first.id !== "number" ||
    typeof first.name !== "string" ||
    typeof first.latitude !== "number" ||
    typeof first.longitude !== "number" ||
    typeof first.timezone !== "string"
  ) {
    return null;
  }

  return {
    id: first.id,
    name: first.name,
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone,
    country: typeof first.country === "string" ? first.country : undefined,
    admin1: typeof first.admin1 === "string" ? first.admin1 : undefined,
  };
}

export type DailyTemps = {
  date: string;
  tmax: number;
  tmin: number;
  tavg: number;
};

function ymdMin(a: string, b: string): string {
  return a < b ? a : b;
}

function parseDailyTemps(json: any): DailyTemps[] {
  const daily = json?.daily;
  if (!daily) return [];

  const time = daily.time as string[] | undefined;
  const tmax = daily.temperature_2m_max as number[] | undefined;
  const tmin = daily.temperature_2m_min as number[] | undefined;
  const tavg = daily.temperature_2m_mean as number[] | undefined;

  if (!Array.isArray(time) || !Array.isArray(tmax) || !Array.isArray(tmin) || !Array.isArray(tavg)) {
    return [];
  }

  const out: DailyTemps[] = [];
  for (let i = 0; i < time.length; i++) {
    const date = time[i];
    const max = tmax[i];
    const min = tmin[i];
    const avg = tavg[i];
    if (typeof date !== "string" || typeof max !== "number" || typeof min !== "number" || typeof avg !== "number") {
      continue;
    }
    out.push({ date, tmax: max, tmin: min, tavg: avg });
  }

  return out;
}

async function fetchDailyTempsFromApi(
  apiUrl: string,
  params: {
    latitude: number;
    longitude: number;
    startDate: string;
    endDate: string;
    timezone: string;
    signal?: AbortSignal;
  },
): Promise<DailyTemps[]> {
  const url = new URL(apiUrl);
  url.searchParams.set("latitude", String(params.latitude));
  url.searchParams.set("longitude", String(params.longitude));
  url.searchParams.set("start_date", params.startDate);
  url.searchParams.set("end_date", params.endDate);
  url.searchParams.set("timezone", params.timezone || "auto");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,temperature_2m_mean");

  const res = await fetch(url, { signal: params.signal });
  if (!res.ok) {
    throw new Error(`Daily fetch failed (${res.status} ${res.statusText})`);
  }

  const json = (await res.json()) as any;
  return parseDailyTemps(json);
}

export async function fetchDailyTempsArchive(params: {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  timezone: string;
  signal?: AbortSignal;
}): Promise<DailyTemps[]> {
  try {
    return await fetchDailyTempsFromApi("https://archive-api.open-meteo.com/v1/archive", params);
  } catch (error) {
    throw new Error(`Archive fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function fetchDailyTempsForecast(params: {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  timezone: string;
  signal?: AbortSignal;
}): Promise<DailyTemps[]> {
  try {
    return await fetchDailyTempsFromApi("https://api.open-meteo.com/v1/forecast", params);
  } catch (error) {
    throw new Error(`Forecast fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function nextDateToFetch(city: City, startDate: string): string {
  const last = city.days.at(-1);
  if (!last) return startDate;
  return addDaysYmd(last.date, 1);
}

export async function syncCityHistoricWeather(
  city: City,
  startDate: string,
  signal?: AbortSignal,
): Promise<{ updated: City; newDays: number; upTo: string | null }> {
  // Always fill data up to (and including) yesterday.
  const targetEnd = yesterdayYmd();

  const missingStart = nextDateToFetch(city, startDate);
  const refreshStart = ymdMax(startDate, addDaysYmd(targetEnd, -14));
  const rangeStart = ymdMin(missingStart, refreshStart);

  if (rangeStart > targetEnd) {
    const upTo = city.days.at(-1)?.date ?? null;
    return { updated: city, newDays: 0, upTo };
  }

  const latestHistoric = latestAvailableHistoricYmd();

  const archiveStart = rangeStart;
  const archiveEnd = ymdMin(targetEnd, latestHistoric);
  const shouldFetchArchive = archiveStart <= archiveEnd;

  const forecastStart = ymdMax(rangeStart, addDaysYmd(latestHistoric, 1));
  const forecastEnd = targetEnd;
  const shouldFetchForecast = forecastStart <= forecastEnd;

  const [forecastTemps, archiveTemps] = await Promise.all([
    shouldFetchForecast
      ? fetchDailyTempsForecast({
          latitude: city.latitude,
          longitude: city.longitude,
          startDate: forecastStart,
          endDate: forecastEnd,
          timezone: city.timezone || "auto",
          signal,
        })
      : Promise.resolve([]),
    shouldFetchArchive
      ? fetchDailyTempsArchive({
          latitude: city.latitude,
          longitude: city.longitude,
          startDate: archiveStart,
          endDate: archiveEnd,
          timezone: city.timezone || "auto",
          signal,
        })
      : Promise.resolve([]),
  ]);

  if (signal?.aborted) {
    const upTo = city.days.at(-1)?.date ?? null;
    return { updated: city, newDays: 0, upTo };
  }

  // Apply forecast first, then archive (archive wins where available).
  const daysByDate = new Map<string, WeatherDay>();
  for (const day of city.days) daysByDate.set(day.date, day);

  let newDays = 0;

  const applyTemps = (temps: DailyTemps[]) => {
    for (const t of temps) {
      const existing = daysByDate.get(t.date);
      const checked = existing?.checked ?? "N";
      if (!existing) newDays++;
      daysByDate.set(t.date, {
        date: t.date,
        tmax: t.tmax,
        tmin: t.tmin,
        tavg: t.tavg,
        checked,
      });
    }
  };

  applyTemps(forecastTemps);
  applyTemps(archiveTemps);

  // Only keep days up to yesterday.
  for (const date of daysByDate.keys()) {
    if (date > targetEnd) daysByDate.delete(date);
  }

  const merged = Array.from(daysByDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const upTo = merged.at(-1)?.date ?? null;

  return { updated: { ...city, days: merged }, newDays, upTo };
}
