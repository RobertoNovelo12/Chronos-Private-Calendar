import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "./stores/themeStore";
import "./styles/globals.css";

initTheme();

// Desactiva el menú contextual nativo del WebView (se sustituirá por menús propios).
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
