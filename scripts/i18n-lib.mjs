// Extracción y comprobación de textos traducibles (sin dependencias).
// Lo usan `scripts/i18n-check.mjs` y las pruebas (`src/lib/__tests__/i18n.test.ts`).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const SIMPLE = new RegExp(String.raw`(?<![\w.])(?:t|tr|msg)\(\s*${STR}`, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.])tp\([^"]*?,\s*${STR}\s*,\s*${STR}`, "gs");

const unescape = (s) => JSON.parse(`"${s}"`);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "locales" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && name !== "test-setup.ts" ? [p] : [];
  });
}

/** Claves del código: Map<texto, { plural, one? }>. */
export function extractKeys(srcDir) {
  const keys = new Map();
  for (const f of files(srcDir)) {
    const code = readFileSync(f, "utf8");
    for (const m of code.matchAll(SIMPLE)) {
      const k = unescape(m[1]);
      if (!keys.has(k)) keys.set(k, { plural: false });
    }
    for (const m of code.matchAll(PLURAL)) keys.set(unescape(m[2]), { plural: true, one: unescape(m[1]) });
  }
  return keys;
}

export const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Problemas de un diccionario frente a las claves (lista vacía = correcto). */
export function checkLocale(keys, dict, code) {
  const problems = [];
  for (const [key, info] of keys) {
    const v = dict[key];
    if (v === undefined) {
      problems.push(`${code}: falta «${key}»`);
      continue;
    }
    const forms = typeof v === "string" ? [v] : Object.values(v);
    if (typeof v !== "string" && typeof v.other !== "string") problems.push(`${code}: «${key}» sin forma "other"`);
    const want = info.plural ? placeholders(key) : placeholders(key);
    for (const f of forms) {
      if (typeof f !== "string" || !f.trim()) problems.push(`${code}: «${key}» vacío`);
      else if (placeholders(f) !== want && !(info.plural && placeholders(f) === placeholders(key).replace(/(^|,)n(,|$)/, "$1").replace(/^,|,$/, "")))
        problems.push(`${code}: «${key}» → «${f}» cambia los marcadores (${want})`);
    }
  }
  for (const key of Object.keys(dict)) if (!keys.has(key)) problems.push(`${code}: sobra «${key}»`);
  return problems;
}
