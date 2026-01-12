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

export type TempToColorRow = {
  tempH: number;
  tempL: number;
  color: number;
};

export type Db = {
  version: 1;
  selectedCityId: string | null;
  cities: City[];
  tempToColorMatrix: TempToColorRow[];
};

export function createEmptyDb(): Db {
  return { version: 1, selectedCityId: null, cities: [], tempToColorMatrix: [] };
}

function isCheckedFlag(value: unknown): value is CheckedFlag {
  return value === "Y" || value === "N";
}

function isTempToColorRow(value: unknown): value is TempToColorRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tempH === "number" &&
    Number.isInteger(v.tempH) &&
    v.tempH >= -50 &&
    v.tempH <= 50 &&
    typeof v.tempL === "number" &&
    Number.isInteger(v.tempL) &&
    v.tempL >= -50 &&
    v.tempL <= 50 &&
    typeof v.color === "number" &&
    Number.isInteger(v.color) &&
    v.color >= -50 &&
    v.color <= 50
  );
}

function isTempToColorMatrix(value: unknown): value is TempToColorRow[] {
  return Array.isArray(value) && value.every(isTempToColorRow);
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

type DbOnDisk = {
  version: 1;
  selectedCityId: string | null;
  cities: City[];
  tempToColorMatrix?: unknown;
};

function isDbOnDisk(value: unknown): value is DbOnDisk {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!(v.selectedCityId === null || typeof v.selectedCityId === "string")) return false;
  if (!Array.isArray(v.cities)) return false;
  if (!v.cities.every(isCity)) return false;
  return true;
}

function normalizeDb(db: DbOnDisk): Db {
  const rawMatrix = db.tempToColorMatrix;
  const tempToColorMatrix: TempToColorRow[] = Array.isArray(rawMatrix)
    ? rawMatrix.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const v = row as Record<string, unknown>;

        const tempHRaw = v.tempH;
        const tempLRaw = v.tempL;
        const colorRaw = v.color;

        const tempH =
          typeof tempHRaw === "number"
            ? tempHRaw
            : typeof tempHRaw === "string"
              ? Number.parseInt(tempHRaw, 10)
              : NaN;

        const tempL =
          typeof tempLRaw === "number"
            ? tempLRaw
            : typeof tempLRaw === "string"
              ? Number.parseInt(tempLRaw, 10)
              : NaN;

        const color =
          typeof colorRaw === "number"
            ? colorRaw
            : typeof colorRaw === "string"
              ? Number.parseInt(colorRaw, 10)
              : NaN;

        const next: TempToColorRow = { tempH, tempL, color };
        return isTempToColorRow(next) ? [next] : [];
      })
    : [];

  return {
    version: 1,
    selectedCityId: db.selectedCityId,
    cities: db.cities,
    tempToColorMatrix,
  };
}

export async function loadDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isDbOnDisk(parsed)) return normalizeDb(parsed);
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
