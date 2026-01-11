import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable, SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { City, Db } from "../db";
import { createEmptyDb, loadDb, saveDb } from "../db";
import { geocodeTopResult, syncCityHistoricWeather } from "../openMeteo";
import { VERSION } from "../version";

type FocusPanel = "add" | "cities" | "weather";

const START_DATE = "2026-01-01";

function nextFocus(current: FocusPanel): FocusPanel {
  switch (current) {
    case "add":
      return "cities";
    case "cities":
      return "weather";
    case "weather":
      return "add";
  }
}

function fmtTemp(value: number): string {
  return value.toFixed(1).padStart(6, " ");
}

function toggleCheckedFlag(flag: "Y" | "N"): "Y" | "N" {
  return flag === "Y" ? "N" : "Y";
}

export function App() {
  const [db, setDb] = useState<Db | null>(null);
  const dbRef = useRef<Db | null>(null);

  const [focus, setFocus] = useState<FocusPanel>("add");
  const [status, setStatus] = useState<string>("Loading...");

  const [daySelectedIndex, setDaySelectedIndex] = useState<number>(0);

  const lastSaveRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const persistDb = useCallback((updater: (prev: Db) => Db) => {
    setDb((prev) => {
      const base = prev ?? createEmptyDb();
      const next = updater(base);
      lastSaveRef.current = saveDb(next).catch((error) => {
        setStatus(`Failed to save DB: ${error instanceof Error ? error.message : String(error)}`);
      });
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadDb();
        if (cancelled) return;

        let fixed: Db = loaded;
        if (loaded.cities.length > 0) {
          const selectedIsValid = loaded.selectedCityId
            ? loaded.cities.some((c) => c.id === loaded.selectedCityId)
            : false;
          if (!selectedIsValid) {
            fixed = { ...loaded, selectedCityId: loaded.cities[0]?.id ?? null };
            lastSaveRef.current = saveDb(fixed).catch((error) => {
              setStatus(`Failed to save DB: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        }

        setDb(fixed);

        const selectedAtStartup = fixed.selectedCityId
          ? fixed.cities.find((c) => c.id === fixed.selectedCityId) ?? null
          : null;

        if (selectedAtStartup && selectedAtStartup.days.length > 0) {
          setFocus("weather");
        }

        setStatus("Ready");
      } catch (error) {
        if (cancelled) return;
        setDb(createEmptyDb());
        setStatus(`Failed to load DB: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    if (db.cities.length === 0) return;

    const selectedIsValid = db.selectedCityId
      ? db.cities.some((c) => c.id === db.selectedCityId)
      : false;

    if (selectedIsValid) return;

    persistDb((prev) => ({ ...prev, selectedCityId: prev.cities[0]?.id ?? null }));
  }, [db, persistDb]);

  const selectedCity = useMemo(() => {
    if (!db?.selectedCityId) return null;
    return db.cities.find((c) => c.id === db.selectedCityId) ?? null;
  }, [db]);

  const selectedCityIndex = useMemo(() => {
    if (!db?.selectedCityId) return 0;
    const idx = db.cities.findIndex((c) => c.id === db.selectedCityId);
    return idx >= 0 ? idx : 0;
  }, [db]);

  const cityOptions = useMemo<SelectOption[]>(() => {
    if (!db) return [];
    return db.cities.map((c) => ({
      name: c.name,
      description: `${c.timezone}  (${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)})`,
      value: c.id,
    }));
  }, [db]);

  const weatherDays = useMemo(() => {
    const days = selectedCity?.days ?? [];
    return [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [selectedCity]);

  const weatherScrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    if (daySelectedIndex < weatherDays.length) return;
    setDaySelectedIndex(Math.max(0, weatherDays.length - 1));
  }, [daySelectedIndex, weatherDays.length]);

  useEffect(() => {
    const scrollbox = weatherScrollRef.current;
    if (!scrollbox) return;
    if (weatherDays.length === 0) return;

    const viewportHeight = scrollbox.viewport.height;
    if (viewportHeight <= 0) return;

    const desiredTop = Math.max(0, daySelectedIndex - Math.floor(viewportHeight / 2));
    scrollbox.scrollTop = desiredTop;
  }, [daySelectedIndex, weatherDays.length]);

  useEffect(() => {
    setDaySelectedIndex(0);
  }, [db?.selectedCityId]);

  const runSyncForSelectedCity = useCallback(
    async (signal?: AbortSignal) => {
      const current = dbRef.current;
      if (!current?.selectedCityId) return;

      const city = current.cities.find((c) => c.id === current.selectedCityId);
      if (!city) return;

      const { updated, newDays, upTo } = await syncCityHistoricWeather(city, START_DATE, signal);
      if (signal?.aborted) return;

      if (newDays === 0) {
        setStatus(upTo ? `Up to date (through ${upTo})` : "No data yet");
        return;
      }

      persistDb((prev) => {
        const cities = prev.cities.map((c) => (c.id === updated.id ? updated : c));
        return { ...prev, cities };
      });

      setStatus(`Fetched ${newDays} day(s). Up to date (through ${upTo ?? "n/a"}).`);
    },
    [persistDb],
  );

  useEffect(() => {
    if (!db?.selectedCityId) return;

    const controller = new AbortController();

    setStatus("Syncing historical data...");
    void runSyncForSelectedCity(controller.signal).catch((error) => {
      if (controller.signal.aborted) return;
      setStatus(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Keep the selected city fresh while the app is running.
    const interval = setInterval(() => {
      const innerController = new AbortController();
      void runSyncForSelectedCity(innerController.signal).catch(() => {});
    }, 60 * 60 * 1000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [db?.selectedCityId, runSyncForSelectedCity]);

  const deleteSelectedCity = () => {
    const current = dbRef.current;
    if (!current?.selectedCityId) return;

    const removeId = current.selectedCityId;
    persistDb((prev) => {
      const idx = prev.cities.findIndex((c) => c.id === removeId);
      const cities = prev.cities.filter((c) => c.id !== removeId);

      let selectedCityId: string | null = prev.selectedCityId;
      if (selectedCityId === removeId) {
        const nextCity = cities[idx] ?? cities[idx - 1] ?? cities[0] ?? null;
        selectedCityId = nextCity?.id ?? null;
      }

      return { ...prev, cities, selectedCityId };
    });

    setStatus("City deleted");
  };

  const toggleCheckedForSelectedDay = () => {
    if (!selectedCity) return;

    const day = weatherDays[daySelectedIndex];
    if (!day) return;

    const date = day.date;

    persistDb((prev) => {
      const cities = prev.cities.map((c) => {
        if (c.id !== selectedCity.id) return c;
        const days = c.days.map((d) =>
          d.date === date ? { ...d, checked: toggleCheckedFlag(d.checked) } : d,
        );
        return { ...c, days };
      });
      return { ...prev, cities };
    });

    setStatus(`Toggled checked for ${date}`);
  };

  const addCity = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setStatus(`Searching for "${trimmed}"...`);

    const result = await geocodeTopResult(trimmed);
    if (!result) {
      setStatus(`No matches for "${trimmed}"`);
      return;
    }

    const display = [result.name, result.admin1, result.country].filter(Boolean).join(", ");
    const id = String(result.id);

    const current = dbRef.current;
    if (current?.cities.some((c) => c.id === id)) {
      setStatus(`City already added: ${display}`);
      persistDb((prev) => ({ ...prev, selectedCityId: id }));
      setFocus("cities");
      return;
    }

    persistDb((prev) => {
      const city: City = {
        id,
        name: display,
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: result.timezone,
        days: [],
      };
      return {
        ...prev,
        cities: [...prev.cities, city],
        selectedCityId: id,
      };
    });

    setFocus("cities");
    setStatus(`Added city: ${display}`);
  };

  const exit = () => {
    void (async () => {
      try {
        await lastSaveRef.current;
      } finally {
        process.exit(0);
      }
    })();
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      exit();
      return;
    }

    if (key.name === "escape" || key.name === "q") {
      exit();
      return;
    }

    if (key.name === "tab") {
      setFocus((prev) => nextFocus(prev));
      return;
    }

    if (focus === "cities" && key.name === "d" && !key.ctrl && !key.meta) {
      deleteSelectedCity();
      return;
    }

    if (focus === "weather" && weatherDays.length > 0) {
      const maxIndex = Math.max(0, weatherDays.length - 1);

      if (key.name === "up" || key.name === "k") {
        setDaySelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.name === "down" || key.name === "j") {
        setDaySelectedIndex((i) => Math.min(maxIndex, i + 1));
        return;
      }

      if (key.name === "home") {
        setDaySelectedIndex(0);
        return;
      }

      if (key.name === "end") {
        setDaySelectedIndex(maxIndex);
        return;
      }

      if ((key.name === "space" || key.name === "c") && !key.ctrl && !key.meta) {
        toggleCheckedForSelectedDay();
        return;
      }
    }
  });

  const weatherTitle = selectedCity ? `Historic weather — ${selectedCity.name}` : "Historic weather";

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", padding: 1, gap: 1 }}>
      <box style={{ width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 }}>
        <box style={{ width: 42, flexDirection: "column", gap: 1 }}>
          <box
            title="Add new city"
            border
            borderStyle="single"
            style={{
              height: 5,
              paddingLeft: 1,
              paddingRight: 1,
              paddingTop: 1,
              borderColor: focus === "add" ? "#22d3ee" : "#444",
              flexDirection: "column",
            }}
          >
            <text fg="#94a3b8">Enter name, press Enter</text>
            <input placeholder="e.g. Berlin" focused={focus === "add"} onSubmit={addCity} />
          </box>

          <box
            title="City selector (d=delete)"
            border
            borderStyle="single"
            style={{
              flexGrow: 1,
              padding: 1,
              borderColor: focus === "cities" ? "#22d3ee" : "#444",
              flexDirection: "column",
            }}
          >
            <select
              style={{ flexGrow: 1 }}
              options={cityOptions}
              selectedIndex={selectedCityIndex}
              showScrollIndicator
              focused={focus === "cities"}
              onChange={(_, option) => {
                setDaySelectedIndex(0);
                if (!option?.value || typeof option.value !== "string") return;
                persistDb((prev) => ({ ...prev, selectedCityId: option.value }));
              }}
            />
            {db && db.cities.length === 0 ? <text fg="#64748b">No cities yet</text> : null}
          </box>
        </box>

        <box
          title={weatherTitle}
          border
          borderStyle="single"
          style={{
            flexGrow: 1,
            padding: 1,
            borderColor: focus === "weather" ? "#22d3ee" : "#444",
            flexDirection: "column",
          }}
        >
          <scrollbox
            ref={weatherScrollRef}
            scrollY
            scrollX={false}
            viewportCulling
            scrollbarOptions={{ showArrows: true }}
            style={{ flexGrow: 1 }}
          >
            <box style={{ flexDirection: "column", width: "100%" }}>
              {weatherDays.map((d, idx) => {
                const fg = d.checked === "Y" ? "#22c55e" : "#ef4444";
                const bg = idx === daySelectedIndex ? "#334155" : "transparent";
                const prefix = idx === daySelectedIndex ? "▶" : " ";
                const line = `${prefix} ${d.date}  max ${fmtTemp(d.tmax)}  min ${fmtTemp(d.tmin)}  avg ${fmtTemp(d.tavg)}  checked:${d.checked}`;
                return <text key={d.date} fg={fg} bg={bg} content={line} />;
              })}
            </box>
          </scrollbox>
          {!selectedCity ? <text fg="#64748b">Select a city to see historic data</text> : null}
          {selectedCity && weatherDays.length === 0 ? <text fg="#64748b">No data yet (syncing)</text> : null}
        </box>
      </box>

      <box style={{ width: "100%", flexDirection: "row", justifyContent: "space-between" }}>
        <text fg="#64748b">Tab: next panel • d: delete city • ↑/↓ or j/k: move day • space/c: toggle checked • q/esc: quit</text>
        <text fg="#a3a3a3">Haakweeroverzicht TUI v{VERSION}</text>
      </box>
    </box>
  );
}
