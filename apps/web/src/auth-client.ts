import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

// Im Produktions-Container werden Weboberflaeche und API von derselben
// Adresse ausgeliefert. Dadurch bleibt ein kopierter Ordner unabhaengig von
// der IP-Adresse des jeweiligen Windows-/Linux-Servers. Fuer die getrennte
// Vite-Entwicklung kann VITE_API_URL weiterhin gesetzt werden.
export const apiUrl = import.meta.env.VITE_API_URL?.trim() || window.location.origin;

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: {
    credentials: "include"
  },
  plugins: [usernameClient()]
});
