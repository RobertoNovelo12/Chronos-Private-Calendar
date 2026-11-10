import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getLanguage, onLanguageChange, useLang } from "./i18n";
import { api } from "./lib/ipc";
import { initTheme } from "./stores/themeStore";
import "./styles/globals.css";

initTheme();

// Desactiva el menú contextual nativo del WebView (se sustituirá por menús propios).
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz");

/** Al cambiar de idioma se vuelve a montar la interfaz con los textos nuevos. */
function Root() {
  const lang = useLang();
  return <App key={lang} />;
}

document.documentElement.lang = getLanguage();
// Las notificaciones y los diálogos de archivos (Rust) usan el mismo idioma.
const tellBackend = (lang: string) => void api.about.setLanguage(lang).catch(() => {});
tellBackend(getLanguage());
onLanguageChange(tellBackend);
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
