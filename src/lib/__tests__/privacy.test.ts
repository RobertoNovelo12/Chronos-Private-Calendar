// Garantías de privacidad comprobadas automáticamente (Fase 6).
// Si un cambio futuro añade una conexión de red, un permiso amplio o una
// dependencia de analítica, estas pruebas fallan.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldAutoCheck } from "@/features/updates/updateStore";
import { parsePrefs } from "@/stores/prefsStore";

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
    // Ningún cliente HTTP directo. La única excepción es el complemento oficial de
    // actualizaciones, solo en la capa de escritorio (ver «actualizaciones» abajo).
    const desktop = read("src-tauri/Cargo.toml");
    const core = read("crates/chronos-core/Cargo.toml");
    expect(desktop).not.toMatch(/^(reqwest|hyper|ureq|surf|isahc|tauri-plugin-(http|shell|upload|websocket))\s*=/m);
    expect(core).not.toMatch(/^(reqwest|hyper|ureq|surf|isahc|tokio|tauri[\w-]*)\s*=/m);
  });
});

describe("privacidad: actualizaciones (única conexión de red)", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const updater = conf.plugins.updater;

  it("solo consulta el latest.json de los Releases oficiales, por https", () => {
    expect(updater.endpoints).toEqual([
      "https://github.com/RobertoNovelo12/Chronos-Private-Calendar/releases/latest/download/latest.json",
    ]);
    expect(JSON.stringify(updater)).not.toMatch(/dangerous/i);
  });

  it("verifica la firma con la clave pública del autor (fijada)", () => {
    const decoded = Buffer.from(updater.pubkey, "base64").toString("utf8");
    expect(decoded).toMatch(/^untrusted comment: minisign public key: EC17C81746F15627\n/);
    expect(decoded).not.toMatch(/secret key/i);
  });

  it("solo descarga desde los Releases oficiales", () => {
    const rs = read("src-tauri/src/commands/update.rs");
    expect(rs).toContain(
      'pub const DOWNLOAD_PREFIX: &str =\n    "https://github.com/RobertoNovelo12/Chronos-Private-Calendar/releases/download/";',
    );
    expect(rs).toMatch(/download_url\.as_str\(\)\.starts_with\(DOWNLOAD_PREFIX\)/);
  });

  it("el frontend no puede usar el actualizador por su cuenta", () => {
    expect(read("src-tauri/capabilities/default.json")).not.toContain("updater");
    expect(read("package.json")).not.toContain("plugin-updater");
  });

  it("solo commands/update.rs usa el actualizador", () => {
    const rustFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return rustFiles(p);
        return name.endsWith(".rs") ? [p] : [];
      });
    const users = rustFiles(join(root, "src-tauri", "src")).filter((f) => /\.updater\(\)|UpdaterExt/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.replace(/\\/g, "/").split("/src-tauri/")[1])).toEqual(["src/commands/update.rs"]);
  });

  it("la comprobación automática está desactivada por defecto y es como mucho diaria", () => {
    expect(parsePrefs(null).autoUpdateCheck).toBe(false);
    expect(parsePrefs(JSON.stringify({ autoUpdateCheck: "sí" })).autoUpdateCheck).toBe(false);
    const day = 86_400_000;
    expect(shouldAutoCheck(false, 0, 10 * day)).toBe(false);
    expect(shouldAutoCheck(true, 10 * day - 1000, 10 * day)).toBe(false);
    expect(shouldAutoCheck(true, 9 * day, 10 * day)).toBe(true);
  });

  it("los paquetes firmados solo se generan en la publicación", () => {
    expect(conf.bundle.createUpdaterArtifacts).toBeUndefined();
    expect(JSON.parse(read("src-tauri/tauri.release.conf.json"))).toEqual({ bundle: { createUpdaterArtifacts: true } });
    const wf = read(".github/workflows/release.yml");
    expect(wf).toContain("--config src-tauri/tauri.release.conf.json");
    expect(wf).toContain("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
  });
});

describe("privacidad: enlace de donaciones", () => {
  const about = read("src-tauri/src/commands/about.rs");

  it("la URL de donaciones es fija, https y exacta", () => {
    expect(about).toContain('pub const DONATION_URL: &str = "https://paypal.me/robertonovelo";');
    expect(about).toMatch(/open_url\(DONATION_URL,/);
  });

  it("el frontend no puede abrir enlaces por su cuenta", () => {
    const cap = read("src-tauri/capabilities/default.json");
    expect(cap).not.toContain("opener");
    expect(read("package.json")).not.toContain("plugin-opener");
  });

  it("ningún otro código de Rust abre direcciones externas", () => {
    const rustFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return rustFiles(p);
        return name.endsWith(".rs") ? [p] : [];
      });
    const openers = rustFiles(join(root, "src-tauri", "src")).filter((f) =>
      /\.opener\(\)|open_url|open_path/.test(readFileSync(f, "utf8")),
    );
    expect(openers.map((f) => f.replace(/\\/g, "/").split("/src-tauri/")[1])).toEqual(["src/commands/about.rs"]);
  });
});

describe("privacidad: escritorio y desbloqueo recordado", () => {
  const rustFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return rustFiles(p);
      return name.endsWith(".rs") ? [p] : [];
    });
  const rel = (f: string) => f.replace(/\\/g, "/").split("/src-tauri/")[1];

  it("el frontend no recibe permisos de inicio automático ni de bandeja", () => {
    const cap = read("src-tauri/capabilities/default.json");
    expect(cap).not.toMatch(/autostart|tray|single-instance/);
    expect(read("package.json")).not.toMatch(/plugin-(autostart|single-instance)/);
  });

  it("solo remember.rs accede al almacén de credenciales del sistema", () => {
    const users = rustFiles(join(root, "src-tauri", "src")).filter((f) => /keyring::|Entry::new/.test(readFileSync(f, "utf8")));
    expect(users.map(rel)).toEqual(["src/remember.rs"]);
  });

  it("recordar el desbloqueo exige la contraseña y no se activa solo", () => {
    const cmd = read("src-tauri/src/commands/desktop.rs");
    expect(cmd).toMatch(/verify_password\(&password\)\?/);
    const lib = read("src-tauri/src/lib.rs");
    // Al arrancar solo se lee; guardarlo solo ocurre desde el comando explícito.
    expect(lib).not.toMatch(/remember::store/);
    const stores = rustFiles(join(root, "src-tauri", "src")).filter((f) => /remember::store\(/.test(readFileSync(f, "utf8")));
    expect(stores.map(rel)).toEqual(["src/commands/desktop.rs"]);
  });

  it("la ventana empieza oculta y Rust decide cuándo mostrarla", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.app.windows[0].visible).toBe(false);
    expect(read("src-tauri/src/lib.rs")).toMatch(/if !desktop::start_hidden\(&args, settings\)/);
  });
});

describe("instalador de Windows", () => {
  it("al actualizar se instala encima sin ofrecer desinstalar (protege los datos)", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.bundle.windows.nsis.template).toBe("windows/installer.nsi");
    const nsi = read("src-tauri/windows/installer.nsi");
    expect(nsi).toMatch(/\$\{ElseIf\} \$R0 = 1\s+;[^\n]*\[Chronos\][\s\S]*?\$\{If\} \$WixMode = 0\s+Abort/);
  });

  it("el instalador está en los idiomas de la app", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.bundle.windows.nsis.languages).toEqual(
      expect.arrayContaining(["English", "Spanish", "SimpChinese", "PortugueseBR", "French", "German", "Japanese", "Korean", "Russian"]),
    );
  });

  it("los campos de contraseña no muestran el botón nativo de WebView2 además del propio", () => {
    expect(read("src/styles/globals.css")).toMatch(/input::-ms-reveal/);
  });
});
