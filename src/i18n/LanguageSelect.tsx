import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES, setLanguage, t, useLang, type LangCode } from "./index";

/** Selector de idioma (los nombres van en su propio idioma). */
export function LanguageSelect({ className, compact = false }: { className?: string; compact?: boolean }) {
  const lang = useLang();
  return (
    <label className={cn("relative inline-flex items-center", className)}>
      {compact && <Languages className="pointer-events-none absolute left-2 size-3.5 text-muted" />}
      <select
        value={lang}
        onChange={(e) => setLanguage(e.target.value as LangCode)}
        aria-label={t("Idioma")}
        className={cn(
          "h-8 cursor-pointer rounded-md bg-control px-2.5 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring",
          compact && "h-7 appearance-none bg-transparent pl-7 pr-2 text-[12px] text-muted hover:bg-surface-hover hover:text-strong",
        )}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
