import { promises as fs } from "node:fs";
import path from "node:path";

export const DB_PATH = path.join(process.cwd(), "data", "weather.json");

export type CheckedFlag = "Y" | "N";

export type WeatherDay = {
  date: string; // YYYY-MM-DD
  tmax: number;
  tmin: number;
  tavg: number;
  checked: CheckedFlag;
};

export type City = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  days: WeatherDay[];
};

export type Db = {
  version: 1;
  selectedCityId: string | null;
  cities: City[];
};

export function createEmptyDb(): Db {
  return { version: 1, selectedCityId: null, cities: [] };
}

function isCheckedFlag(value: unknown): value is CheckedFlag {
  return value === "Y" || value === "N";
}

function isWeatherDay(value: unknown): value is WeatherDay {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.date === "string" &&
    typeof v.tmax === "number" &&
    typeof v.tmin === "number" &&
    typeof v.tavg === "number" &&
    isCheckedFlag(v.checked)
  );
}

function isCity(value: unknown): value is City {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    typeof v.latitude !== "number" ||
    typeof v.longitude !== "number" ||
    typeof v.timezone !== "string" ||
    !Array.isArray(v.days)
  ) {
    return false;
  }
  return v.days.every(isWeatherDay);
}

function isDb(value: unknown): value is Db {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!(v.selectedCityId === null || typeof v.selectedCityId === "string")) return false;
  if (!Array.isArray(v.cities)) return false;
  return v.cities.every(isCity);
}

export async function loadDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isDb(parsed)) return parsed;
    return createEmptyDb();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return createEmptyDb();
    throw error;
  }
}

export async function saveDb(db: Db): Promise<void> {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

  const tmpPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, DB_PATH);
}
