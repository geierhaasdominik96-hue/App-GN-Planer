import type { ApiErrorResponse } from "@gn-planer/contracts";
import { apiUrl } from "./auth-client.js";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const fallback = { message: "Die Anfrage konnte nicht verarbeitet werden." };
    const error = (await response.json().catch(() => fallback)) as ApiErrorResponse;
    throw new Error(error.message);
  }
  return response.json() as Promise<T>;
}

export async function downloadAuthenticated(path: string, filename: string) {
  const response = await fetch(`${apiUrl}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error("Die Datei konnte nicht erstellt werden.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
