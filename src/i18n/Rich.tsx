import { Fragment } from "react";

/**
 * Muestra un texto traducido con negritas `<b>…</b>` (única etiqueta
 * admitida; el resto se muestra tal cual, nunca como HTML).
 */
export function Rich({ text, boldClass }: { text: string; boldClass?: string }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<b>") && p.endsWith("</b>") ? (
          <b key={i} className={boldClass}>
            {p.slice(3, -4)}
          </b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
