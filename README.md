# Haakweeroverzicht TUI

A 3-panel terminal UI to maintain historic daily temperature records (high/low/avg) for user-selected cities.

Data is fetched from Open-Meteo Historical Weather API and stored locally in a JSON file with an extra user-controlled flag per day: `checked: "Y" | "N"`.

## Requirements

- Bun
- Zig (required by `@opentui/core` native bindings)

## Run

```bash
bun install
bun run start
```

## Distribution (macOS/Linux)

```bash
bun run dist:build
./dist/haakweeroverzicht-tui
```

The `dist/` folder also contains the required OpenTUI native library under `dist/node_modules/`.

## Keybindings

- `Tab`: cycle focus across the 3 panels
- `d`: delete currently selected city (when focus is on **City selector**)
- `space` or `c`: toggle `checked` for the currently selected day (when focus is on **Historic weather**)
- `q` or `Esc`: quit
- `Ctrl+C`: quit

## Data storage

- File: `data/weather.json` (created automatically)
- Structure:
  - `cities[]` with `id`, `name`, `latitude`, `longitude`, `timezone`
  - `days[]` per city, with `{ date, tmax, tmin, tavg, checked }`

## Notes

- Open-Meteo historical data has a 5-day delay, so the most recent days will appear only after they become available.
# haakweeroverzicht-tui
