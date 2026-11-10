// Comprueba que todos los idiomas tengan todos los textos de la interfaz.
//   node scripts/i18n-check.mjs            → informe (sale con error si falta algo)
//   node scripts/i18n-check.mjs --keys     → escribe scripts/i18n-keys.json (para traducir)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { checkLocale, extractKeys } from "./i18n-lib.mjs";

const keys = extractKeys("src");
if (process.argv.includes("--keys")) {
  writeFileSync("scripts/i18n-keys.json", JSON.stringify(Object.fromEntries(keys), null, 2) + "\n");
  console.log(`${keys.size} textos → scripts/i18n-keys.json`);
}
let problems = [];
for (const file of readdirSync("src/i18n/locales")) {
  const dict = JSON.parse(readFileSync(`src/i18n/locales/${file}`, "utf8"));
  problems = problems.concat(checkLocale(keys, dict, file.replace(".json", "")));
}
console.log(`${keys.size} textos; ${problems.length} problemas`);
for (const p of problems.slice(0, 60)) console.log("  " + p);
process.exit(problems.length ? 1 : 0);
