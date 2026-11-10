import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { checkLocale, extractKeys } from "../../../scripts/i18n-lib.mjs";
import { detectLanguage, getLanguage, LANGUAGES, setLanguage, t, tp } from "@/i18n";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

describe("traducciones", () => {
  const keys = extractKeys(SRC);

  it("encuentra los textos del código", () => {
    expect(keys.size).toBeGreaterThan(400);
  });

  for (const lang of LANGUAGES.filter((l) => l.code !== "es")) {
    it(`${lang.code} está completo y conserva los marcadores`, () => {
      expect(checkLocale(keys, lang.msgs, lang.code)).toEqual([]);
    });
  }

  it("los códigos son únicos y tienen nombre nativo", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of LANGUAGES) expect(l.name.length).toBeGreaterThan(1);
  });
});

describe("detectLanguage", () => {
  it("elige el primer idioma disponible del sistema", () => {
    expect(detectLanguage(["it-IT", "fr-CA", "en"])).toBe("fr");
    expect(detectLanguage(["zh-TW"])).toBe("zh-CN");
    expect(detectLanguage(["pt-PT"])).toBe("pt-BR");
    expect(detectLanguage(["es-MX"])).toBe("es");
  });
  it("usa inglés si no hay ninguno", () => {
    expect(detectLanguage(["it-IT", "nl"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
});

describe("t y tp", () => {
  it("traducen, sustituyen y pluralizan", () => {
    try {
      setLanguage("en");
      expect(getLanguage()).toBe("en");
      expect(t("Nuevo evento")).toBe("New event");
      expect(tp(1, "{n} evento", "{n} eventos")).toBe("1 event");
      expect(tp(1200, "{n} evento", "{n} eventos")).toBe("1,200 events");
      setLanguage("ru");
      expect(tp(1, "{n} evento", "{n} eventos")).toBe("1 событие");
      expect(tp(3, "{n} evento", "{n} eventos")).toBe("3 события");
      expect(tp(5, "{n} evento", "{n} eventos")).toBe("5 событий");
      setLanguage("ja");
      expect(t("Hoy")).not.toBe("Hoy");
      setLanguage("es");
      expect(tp(2, "{n} evento", "{n} eventos")).toBe("2 eventos");
      expect(t("Texto sin traducir {x}", { x: 1 })).toBe("Texto sin traducir 1");
    } finally {
      setLanguage("es");
    }
  });
});
