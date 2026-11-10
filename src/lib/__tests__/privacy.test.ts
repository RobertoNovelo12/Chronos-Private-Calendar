// Garantías de privacidad comprobadas automáticamente (Fase 6).
// Si un cambio futuro añade una conexión de red, un permiso amplio o una
// dependencia de analítica, estas pruebas fallan.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("privacidad: sin red", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const csp: Record<string, string> = conf.app.security.csp;

  it("la CSP de producción no permite orígenes externos", () => {
    expect(csp["default-src"]).toBe("'self'");
    expect(csp["script-src"]).toBe("'self'");
    expect(csp["connect-src"]).toBe("ipc: http://ipc.localhost");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp["frame-src"]).toBe("'none'");
    expect(csp["form-action"]).toBe("'none'");
    for (const [directive, value] of Object.entries(csp)) {
      // Solo el puente interno de Tauri (ipc.localhost) puede llevar esquema http.
      const external = value.split(/\s+/).filter((v) => /^(https?|wss?):/.test(v) && v !== "http://ipc.localhost");
      expect(external, directive).toEqual([]);
      expect(value, directive).not.toContain("*");
    }
  });

  it("el frontend solo tiene permisos mínimos", () => {
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(cap.permissions).toEqual(["core:default", "notification:default"]);
    expect(conf.app.withGlobalTauri).toBe(false);
  });

  it("el código del frontend no usa APIs de red", () => {
    const forbidden = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|navigator\.connection)\b/;
    const offenders = sourceFiles(join(root, "src")).filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no hay recursos remotos en la página", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/(src|href)=["']https?:/);
    const css = read("src/styles/globals.css");
    expect(css).not.toMatch(/@import\s+(url\()?["']?https?:/);
  });

  it("no hay dependencias de analítica, telemetría o servicios remotos", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const suspicious = deps.filter((d) =>
      /analytics|sentry|posthog|mixpanel|segment|amplitude|datadog|bugsnag|firebase|supabase|axios|plugin-http|plugin-updater|plugin-shell/i.test(d),
    );
    expect(suspicious).toEqual([]);
    const cargo = read("src-tauri/Cargo.toml") + read("crates/chronos-core/Cargo.toml");
    expect(cargo).not.toMatch(/^(reqwest|hyper|ureq|surf|isahc|tauri-plugin-(http|updater|shell))\s*=/m);
  });
});
