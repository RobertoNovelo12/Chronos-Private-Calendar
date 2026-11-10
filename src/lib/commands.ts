// Filtrado y orden de las acciones del menú de comandos (Ctrl+K).

import { fold } from "./nlp";

export interface Rankable {
  id: string;
  /** Texto visible (ya traducido). */
  label: string;
  /** Otras palabras que también encuentran la acción (p. ej. el texto en español). */
  keywords?: string[];
}

const words = (s: string) => s.split(/[\s/·,.:;()«»"'-]+/u).filter(Boolean);

/**
 * Puntuación de `text` para la búsqueda `query` (0 = no coincide). Sin acentos
 * ni mayúsculas. De mayor a menor: igual, empieza igual, empieza una palabra,
 * contiene, todas las palabras empiezan alguna palabra, iniciales en orden.
 */
export function matchScore(text: string, query: string): number {
  const q = fold(query.trim());
  if (!q) return 1;
  const s = fold(text);
  if (s === q) return 100;
  if (s.startsWith(q)) return 90;
  const ws = words(s);
  if (ws.some((w) => w.startsWith(q))) return 70;
  if (s.includes(q)) return 50;
  const qs = words(q);
  if (qs.length > 1 && qs.every((qw) => ws.some((w) => w.startsWith(qw)))) return 40;
  // Letras en orden empezando al principio de una palabra («nt» → «Nueva tarea»).
  if (q.length >= 2) {
    for (let start = 0; start < s.length; start++) {
      if (s[start] !== q[0] || (start > 0 && /[\p{L}\p{N}]/u.test(s[start - 1]!))) continue;
      let i = 1;
      let gaps = 0;
      for (let j = start + 1; j < s.length && i < q.length; j++) {
        if (s[j] === q[i]) i++;
        else gaps++;
      }
      if (i === q.length) return Math.max(1, 25 - gaps / 2);
    }
  }
  return 0;
}

/** Ordena por puntuación (estable) y descarta lo que no coincide. */
export function rankCommands<T extends Rankable>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(matchScore(item.label, query), ...(item.keywords ?? []).map((k) => matchScore(k, query) - 1)),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
