export function formatYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseYmd(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function addDaysYmd(date: string, days: number): string {
  const d = parseYmd(date);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

export function ymdMax(a: string, b: string): string {
  return a > b ? a : b;
}

export function todayYmd(): string {
  return formatYmd(new Date());
}

export function yesterdayYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatYmd(d);
}

export function latestAvailableHistoricYmd(): string {
  // Open-Meteo historical data has a 5-day delay.
  const d = new Date();
  d.setDate(d.getDate() - 5);
  return formatYmd(d);
}
