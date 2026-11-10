// Traducciones de la interfaz.
//
// El texto en español es la clave (`t("Nuevo evento")`): así el código se lee
// igual que antes y el español no necesita archivo. Cada idioma tiene un JSON
// con «texto en español → traducción». `scripts/i18n-check.mjs` y las pruebas
// comprueban que ningún idioma tenga textos sin traducir ni marcadores rotos.
//
// Sin red ni dependencias: todo va dentro del binario.

import type { Locale } from "date-fns";
import { de, enUS, es, fr, ja, ko, ptBR, ru, zhCN } from "date-fns/locale";
import { create } from "zustand";
import deMsgs from "./locales/de.json";
import enMsgs from "./locales/en.json";
import frMsgs from "./locales/fr.json";
import jaMsgs from "./locales/ja.json";
import koMsgs from "./locales/ko.json";
import ptMsgs from "./locales/pt-BR.json";
import ruMsgs from "./locales/ru.json";
import zhMsgs from "./locales/zh-CN.json";

/** Formas plurales según `Intl.PluralRules` (one, few, many, other…) y "=1" opcional. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule | "=1", string>> & { other: string };
type Messages = Record<string, string | PluralForms>;

export const LANGUAGES = [
  { code: "es", name: "Español", date: es, msgs: {} as Messages },
  { code: "en", name: "English", date: enUS, msgs: enMsgs as Messages },
  { code: "zh-CN", name: "简体中文", date: zhCN, msgs: zhMsgs as Messages },
  { code: "pt-BR", name: "Português (Brasil)", date: ptBR, msgs: ptMsgs as Messages },
  { code: "fr", name: "Français", date: fr, msgs: frMsgs as Messages },
  { code: "de", name: "Deutsch", date: de, msgs: deMsgs as Messages },
  { code: "ja", name: "日本語", date: ja, msgs: jaMsgs as Messages },
  { code: "ko", name: "한국어", date: ko, msgs: koMsgs as Messages },
  { code: "ru", name: "Русский", date: ru, msgs: ruMsgs as Messages },
] as const satisfies readonly { code: string; name: string; date: Locale; msgs: Messages }[];

export type LangCode = (typeof LANGUAGES)[number]["code"];

const KEY = "chronos.lang";

/** Idioma del sistema si está disponible; si no, inglés (o español si el sistema está en español). */
export function detectLanguage(candidates: readonly string[] = navigator.languages ?? [navigator.language]): LangCode {
  for (const c of candidates) {
    const lc = c.toLowerCase();
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === lc);
    if (exact) return exact.code;
    const base = lc.split("-")[0];
    if (base === "zh") return "zh-CN";
    if (base === "pt") return "pt-BR";
    const byBase = LANGUAGES.find((l) => l.code.split("-")[0] === base);
    if (byBase) return byBase.code;
  }
  return "en";
}

function initialLanguage(): LangCode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored as LangCode;
  } catch {
    /* almacenamiento no disponible */
  }
  try {
    return detectLanguage();
  } catch {
    return "es";
  }
}

let current: (typeof LANGUAGES)[number] = LANGUAGES.find((l) => l.code === initialLanguage()) ?? LANGUAGES[0];
let plurals = new Intl.PluralRules(current.code);

/** Idioma activo (para re-renderizar al cambiarlo). */
export const useLangStore = create<{ lang: LangCode }>(() => ({ lang: current.code }));

export function getLanguage(): LangCode {
  return current.code;
}

export function setLanguage(code: LangCode): void {
  const next = LANGUAGES.find((l) => l.code === code);
  if (!next) return;
  current = next;
  plurals = new Intl.PluralRules(code);
  if (typeof document !== "undefined") document.documentElement.lang = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* sin almacenamiento: solo para esta sesión */
  }
  for (const fn of listeners) fn(code);
  useLangStore.setState({ lang: code });
}

const listeners = new Set<(code: LangCode) => void>();
/** Avisa de cambios de idioma (p. ej. para informar al backend). */
export function onLanguageChange(fn: (code: LangCode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Locale de date-fns del idioma activo. */
export function dateLocale(): Locale {
  return current.date;
}

/** Etiqueta BCP 47 para `Intl` y `toLocale*`. */
export function intlLocale(): string {
  return current.code;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    const v = vars[k]!;
    return typeof v === "number" ? v.toLocaleString(current.code) : v;
  });
}

/** Traduce `key` (texto en español) y sustituye `{variables}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const found = current.msgs[key];
  const text = typeof found === "string" ? found : found ? found.other : key;
  return fill(text, vars);
}

/**
 * Plural: `tp(n, "{n} evento", "{n} eventos")`. La clave de traducción es la
 * forma plural en español; la traducción puede dar todas las formas del idioma.
 */
export function tp(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const all = { n, ...vars };
  if (current.code === "es") return fill(n === 1 ? one : other, all);
  const found = current.msgs[other];
  if (!found) return fill(n === 1 ? one : other, all);
  if (typeof found === "string") return fill(found, all);
  // "=1": forma exacta para 1 en idiomas sin singular gramatical (chino, japonés, coreano).
  if (n === 1 && found["=1"]) return fill(found["=1"], all);
  const form = plurals.select(n);
  return fill(found[form] ?? found.other, all);
}

/**
 * Marca un texto para traducir sin traducirlo todavía (listas definidas fuera
 * de los componentes). Se traduce al mostrarlo con `t(texto)`.
 */
export function msg<S extends string>(key: S): S {
  return key;
}

/** Hook: re-renderiza el componente al cambiar de idioma. */
export function useLang(): LangCode {
  return useLangStore((s) => s.lang);
}
