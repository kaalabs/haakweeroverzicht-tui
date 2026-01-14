import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable, SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { City, Db, TempToColorRow } from "../db";
import { createEmptyDb, loadDb, saveDb } from "../db";
import { geocodeTopResult, syncCityHistoricWeather } from "../openMeteo";
import { VERSION } from "../version";
import { theme } from "./theme";

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

function fmtInt(value: number): string {
  return String(value).padStart(6, " ");
}

function fmtColorNumber(value: number | null): string {
  if (value === null) return "--";
  return String(value);
}

function toggleCheckedFlag(flag: "Y" | "N"): "Y" | "N" {
  return flag === "Y" ? "N" : "Y";
}

function colorForTemp(matrix: TempToColorRow[], temp: number): number | null {
  for (const row of matrix) {
    const low = Math.min(row.tempL, row.tempH);
    const high = Math.max(row.tempL, row.tempH);
    if (temp >= low && temp <= high) return row.color;
  }
  return null;
}

function fmtTempValue(value: number): string {
  return String(value);
}

function rangesOverlap(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return Math.max(aLow, bLow) <= Math.min(aHigh, bHigh);
}

function clampIntRange(value: number): number {
  return Math.max(-50, Math.min(50, value));
}

function sanitizeIntText(value: string): string {
  const cleaned = value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
  if (cleaned === "" || cleaned === "-") return cleaned;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) return "";
  return String(clampIntRange(parsed));
}

export function App() {
  const [db, setDb] = useState<Db | null>(null);
  const dbRef = useRef<Db | null>(null);

  const [focus, setFocus] = useState<FocusPanel>("add");
  const [status, setStatus] = useState<string>("Loading...");

  const [daySelectedIndex, setDaySelectedIndex] = useState<number>(0);

  const [showStartupModal, setShowStartupModal] = useState(true);

  const [showTempToColorModal, setShowTempToColorModal] = useState(false);
  const [tempToColorDraft, setTempToColorDraft] = useState<TempToColorRow[]>([]);
  const tempToColorDraftRef = useRef<TempToColorRow[]>([]);
  const [tempToColorSelectedIndex, setTempToColorSelectedIndex] = useState(0);
  const [tempToColorError, setTempToColorError] = useState<string | null>(null);

  const [tempToColorIsAdding, setTempToColorIsAdding] = useState(false);
  const [tempToColorNewRow, setTempToColorNewRow] = useState({ tempH: "", tempL: "", color: "" });
  const [tempToColorNewRowField, setTempToColorNewRowField] = useState<0 | 1 | 2>(0);

  const lastSaveRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  useEffect(() => {
    tempToColorDraftRef.current = tempToColorDraft;
  }, [tempToColorDraft]);

  useEffect(() => {
    const timer = setTimeout(() => setShowStartupModal(false), 2000);
    return () => clearTimeout(timer);
  }, []);

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

  const openTempToColorModal = useCallback(() => {
    const current = dbRef.current ?? createEmptyDb();
    setTempToColorDraft(current.tempToColorMatrix);
    setTempToColorSelectedIndex(0);
    setTempToColorError(null);
    setTempToColorIsAdding(false);
    setTempToColorNewRow({ tempH: "", tempL: "", color: "" });
    setTempToColorNewRowField(0);
    setShowTempToColorModal(true);
  }, []);

  const saveAndCloseTempToColorModal = useCallback(() => {
    const draft = tempToColorDraftRef.current;
    persistDb((prev) => ({ ...prev, tempToColorMatrix: draft }));
    setShowTempToColorModal(false);
    setTempToColorIsAdding(false);
    setTempToColorError(null);
    setStatus("Saved Temp-to-Color matrix");
  }, [persistDb]);

  const tryConfirmTempToColorNewRow = useCallback((override?: { color?: string }): boolean => {
    const tempHText = tempToColorNewRow.tempH.trim();
    const tempLText = tempToColorNewRow.tempL.trim();
    const colorText = (override?.color ?? tempToColorNewRow.color).trim();

    if (!tempLText) {
      setTempToColorError("Temp low is required.");
      setTempToColorNewRowField(0);
      return false;
    }

    if (!tempHText) {
      setTempToColorError("Temp high is required.");
      setTempToColorNewRowField(1);
      return false;
    }

    if (!colorText) {
      setTempToColorError("Color code is required.");
      setTempToColorNewRowField(2);
      return false;
    }

    const tempH = Number.parseInt(tempHText, 10);
    const tempL = Number.parseInt(tempLText, 10);
    const color = Number.parseInt(colorText, 10);

    if (!Number.isFinite(tempH) || !Number.isFinite(tempL)) {
      setTempToColorError("Temp high/low must be integers.");
      return false;
    }

    if (!Number.isInteger(tempH) || !Number.isInteger(tempL) || !Number.isInteger(color)) {
      setTempToColorError("Temp high/low/color must be integers.");
      return false;
    }

    if (tempH < -50 || tempH > 50 || tempL < -50 || tempL > 50 || color < -50 || color > 50) {
      setTempToColorError("Temp high/low/color must be in range -50..50.");
      return false;
    }

    const newLow = Math.min(tempL, tempH);
    const newHigh = Math.max(tempL, tempH);

    const existing = tempToColorDraftRef.current;
    for (const row of existing) {
      const low = Math.min(row.tempL, row.tempH);
      const high = Math.max(row.tempL, row.tempH);
      if (!rangesOverlap(newLow, newHigh, low, high)) continue;

      setTempToColorError(
        `Range ${fmtTempValue(newLow)}..${fmtTempValue(newHigh)} overlaps existing ${fmtTempValue(low)}..${fmtTempValue(high)} (color "${row.color}")`,
      );
      return false;
    }

    const row: TempToColorRow = { tempH, tempL, color };
    const idx = tempToColorDraftRef.current.length;
    setTempToColorDraft((prev) => [...prev, row]);
    setTempToColorSelectedIndex(idx);
    setTempToColorIsAdding(false);
    setTempToColorNewRow({ tempH: "", tempL: "", color: "" });
    setTempToColorNewRowField(0);
    setTempToColorError(null);
    setStatus("Added Temp-to-Color matrix row");
    return true;
  }, [tempToColorNewRow]);

  useEffect(() => {
    if (!showTempToColorModal) return;
    if (tempToColorSelectedIndex < tempToColorDraft.length) return;
    setTempToColorSelectedIndex(Math.max(0, tempToColorDraft.length - 1));
  }, [showTempToColorModal, tempToColorDraft.length, tempToColorSelectedIndex]);

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
    if (showTempToColorModal) {
      if (key.name === "escape") {
        if (tempToColorIsAdding) {
          setTempToColorIsAdding(false);
          setTempToColorNewRow({ tempH: "", tempL: "", color: "" });
          setTempToColorNewRowField(0);
          setTempToColorError(null);
          return;
        }
        saveAndCloseTempToColorModal();
        return;
      }

      if (tempToColorIsAdding) {
        if (key.name === "tab") {
          setTempToColorNewRowField((prev) => ((prev + 1) % 3) as 0 | 1 | 2);
        }
        return;
      }

      if (tempToColorDraft.length > 0) {
        const maxIndex = Math.max(0, tempToColorDraft.length - 1);
        if (key.name === "up" || key.name === "k") {
          setTempToColorSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down" || key.name === "j") {
          setTempToColorSelectedIndex((i) => Math.min(maxIndex, i + 1));
          return;
        }
      }

      if (key.name === "a" && !key.ctrl && !key.meta) {
        setTempToColorIsAdding(true);
        setTempToColorNewRow({ tempH: "", tempL: "", color: "" });
        setTempToColorNewRowField(0);
        setTempToColorError(null);
        return;
      }

      if (key.name === "d" && !key.ctrl && !key.meta) {
        if (tempToColorDraft.length === 0) return;
        setTempToColorDraft((prev) => {
          const next = prev.filter((_, idx) => idx !== tempToColorSelectedIndex);
          const nextIndex = Math.max(0, Math.min(tempToColorSelectedIndex, next.length - 1));
          setTempToColorSelectedIndex(nextIndex);
          return next;
        });
        return;
      }

      return;
    }

    if (key.ctrl && key.name === "c") {
      exit();
      return;
    }

    if (key.name === "c" && !key.ctrl && !key.meta) {
      openTempToColorModal();
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

      if (key.name === "space" && !key.ctrl && !key.meta) {
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
              borderColor: focus === "add" ? theme.border.active : theme.border.inactive,
              flexDirection: "column",
            }}
          >
            <text fg={theme.input.placeholder}>Enter name, press Enter</text>
            <input placeholder="e.g. Berlin" focused={focus === "add"} onSubmit={addCity} />
          </box>

          <box
            title="City selector (d=delete)"
            border
            borderStyle="single"
            style={{
              flexGrow: 1,
              padding: 1,
              borderColor: focus === "cities" ? theme.border.active : theme.border.inactive,
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
            {db && db.cities.length === 0 ? <text fg={theme.text.muted}>No cities yet</text> : null}
          </box>
        </box>

        <box
          title={weatherTitle}
          border
          borderStyle="single"
          style={{
            flexGrow: 1,
            padding: 1,
            borderColor: focus === "weather" ? theme.border.active : theme.border.inactive,
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
                const bg = idx === daySelectedIndex ? theme.background.selection : theme.background.transparent;
                const prefix = idx === daySelectedIndex ? "▶" : " ";
                const matrix = db?.tempToColorMatrix ?? [];
                const maxColor = colorForTemp(matrix, Math.round(d.tmax));
                const line = `${prefix} ${d.date}  max ${fmtTemp(d.tmax)}  min ${fmtTemp(d.tmin)}  avg ${fmtTemp(d.tavg)}  clr ${fmtColorNumber(maxColor).padStart(3, " ")}`;
                return <text key={d.date} fg={fg} bg={bg} content={line} />;
              })}
            </box>
          </scrollbox>
          {!selectedCity ? <text fg={theme.text.muted}>Select a city to see historic data</text> : null}
          {selectedCity && weatherDays.length === 0 ? <text fg={theme.text.muted}>No data yet (syncing)</text> : null}
        </box>
      </box>

      <box style={{ width: "100%", flexDirection: "row", justifyContent: "space-between" }}>
        <text fg={theme.text.muted}>Tab: next panel • c: temp-color matrix • d: delete city • ↑/↓ or j/k: move day • space: toggle checked • q/esc: quit</text>
        <text fg={theme.text.version}>Haakweeroverzicht TUI v{VERSION}</text>
      </box>

      {showStartupModal ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          justifyContent="center"
          alignItems="center"
          zIndex={1000}
        >
          <box
            border
            borderStyle="single"
            borderColor={theme.border.modal}
            backgroundColor={theme.background.modal}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg={theme.text.modalTitle}>Made with Love for Caroline Kortekaas</text>
          </box>
        </box>
      ) : null}

      {showTempToColorModal ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          justifyContent="center"
          alignItems="center"
          zIndex={1100}
        >
          <box
            title="Temp-to-Color matrix"
            border
            borderStyle="single"
            borderColor={theme.border.modal}
            backgroundColor={theme.background.modal}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={2}
            style={{ width: 78, height: 22, flexDirection: "column", gap: 1 }}
          >
            <text fg={theme.input.placeholder}>a: add row • d: delete row • ↑/↓: select • Esc: save/close</text>

            <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 6 }}>
              <box style={{ flexDirection: "row" }}>
                <text fg={theme.text.muted} content={`   tempL    tempH  clr`} />
              </box>
              <scrollbox
                scrollY
                scrollX={false}
                viewportCulling
                style={{ flexGrow: 1, flexShrink: 1, minHeight: 4 }}
              >
                <box style={{ flexDirection: "column", width: "100%" }}>
                  {tempToColorDraft.length === 0 ? (
                    <text fg={theme.text.muted}>No rows yet. Press a to add one.</text>
                  ) : (
                    tempToColorDraft.map((row, idx) => {
                      const bg = idx === tempToColorSelectedIndex ? theme.background.selection : theme.background.transparent;
                      const prefix = idx === tempToColorSelectedIndex ? "▶" : " ";
                      const line = `${prefix} ${fmtInt(row.tempL)}  ${fmtInt(row.tempH)}  ${fmtColorNumber(row.color).padStart(3, " ")}`;
                      return <text key={`${idx}`} fg={theme.text.primary} bg={bg} content={line} />;
                    })
                  )}
                </box>
              </scrollbox>
            </box>

            {tempToColorIsAdding ? (
              <box style={{ flexDirection: "column", gap: 1, flexShrink: 0, height: 7 }}>
                <text fg={theme.primary.error} content={tempToColorError ?? " "} />
                <text fg={theme.input.placeholder}>New row (Tab: next field • Enter: confirm • Esc: cancel)</text>
                <box style={{ flexDirection: "column", gap: 0, height: 2 }}>
                  <box style={{ flexDirection: "row", gap: 2, height: 1 }}>
                    <box style={{ flexGrow: 1 }}>
                      <text fg={theme.input.label}>Temp low</text>
                    </box>
                    <box style={{ flexGrow: 1 }}>
                      <text fg={theme.input.label}>Temp high</text>
                    </box>
                    <box style={{ width: 14 }}>
                      <text fg={theme.input.label}>Color #</text>
                    </box>
                  </box>

                  <box style={{ flexDirection: "row", gap: 2, height: 1 }}>
                    <box style={{ flexGrow: 1 }}>
                      <input
                        placeholder="e.g. 0"
                        focused={tempToColorNewRowField === 0}
                        value={tempToColorNewRow.tempL}
                        onInput={(value) =>
                          setTempToColorNewRow((prev) => ({ ...prev, tempL: sanitizeIntText(value) }))
                        }
                        onSubmit={() => {
                          setTempToColorNewRowField(1);
                        }}
                      />
                    </box>
                    <box style={{ flexGrow: 1 }}>
                      <input
                        placeholder="e.g. 5"
                        focused={tempToColorNewRowField === 1}
                        value={tempToColorNewRow.tempH}
                        onInput={(value) =>
                          setTempToColorNewRow((prev) => ({ ...prev, tempH: sanitizeIntText(value) }))
                        }
                        onSubmit={() => {
                          setTempToColorNewRowField(2);
                        }}
                      />
                    </box>
                    <box style={{ width: 14 }}>
                      <input
                        placeholder="e.g. 3"
                        focused={tempToColorNewRowField === 2}
                        value={tempToColorNewRow.color}
                        onInput={(value) =>
                          setTempToColorNewRow((prev) => ({ ...prev, color: sanitizeIntText(value) }))
                        }
                        onSubmit={(value) => {
                          tryConfirmTempToColorNewRow({ color: sanitizeIntText(value) });
                        }}
                      />
                    </box>
                  </box>
                </box>
              </box>
            ) : null}
          </box>
        </box>
      ) : null}
    </box>
  );
}
