// Ejecuta las pruebas del frontend en varias zonas horarias (incluidas zonas
// con media hora de desfase y del hemisferio sur), porque los errores de fechas
// suelen aparecer solo lejos de la zona del desarrollador.
import { spawnSync } from "node:child_process";

const zones = ["America/Mexico_City", "America/New_York", "Europe/Madrid", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "UTC"];
let failed = 0;
for (const tz of zones) {
  const r = spawnSync("npx", ["vitest", "run", "--reporter=dot"], {
    env: { ...process.env, TZ: tz },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${tz}`);
  if (!ok) console.log(r.stdout, r.stderr);
}
process.exit(failed ? 1 : 0);
