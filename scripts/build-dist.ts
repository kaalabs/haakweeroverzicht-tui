import { rm, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";

function binName(): string {
  return process.platform === "win32" ? "haakweeroverzicht-tui.exe" : "haakweeroverzicht-tui";
}

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const outBin = path.join(distDir, binName());

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const build = Bun.spawnSync([
  "bun",
  "build",
  "src/main.tsx",
  "--compile",
  "--outfile",
  outBin,
]);

if (build.exitCode !== 0) {
  process.exit(build.exitCode ?? 1);
}

const opentuiScopedDir = path.join(rootDir, "node_modules", "@opentui");
const platformPackage = `core-${process.platform}-${process.arch}`;
const platformPackageSrc = path.join(opentuiScopedDir, platformPackage);
const platformPackageDst = path.join(distDir, "node_modules", "@opentui", platformPackage);

await mkdir(path.dirname(platformPackageDst), { recursive: true });
await cp(platformPackageSrc, platformPackageDst, { recursive: true });

await writeFile(
  path.join(distDir, "README.txt"),
  [
    "Haakweeroverzicht TUI distribution",
    "",
    `Binary: ${binName()}`,
    "",
    "Run from this folder so the bundled OpenTUI native library can be found:",
    process.platform === "win32" ? `  .\\${binName()}` : `  ./${binName()}`,
    "",
  ].join("\n"),
  "utf8",
);
