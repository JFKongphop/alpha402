// Text-to-speech via the server /speak endpoint (Paxa Labs behind it).
const BASE = (import.meta as any).env?.VITE_API ?? "/api";

/** Fetch spoken audio for `text`; returns an object URL to play, or null on failure. */
export async function fetchSpeech(text: string, voice?: string): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    if (!r.ok) return null;
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Clean up symbols so the voice reads naturally. */
export function sayable(text: string): string {
  return text
    .replace(/ℏ/g, " hbar")
    .replace(/→/g, ", ")
    .replace(/×/g, " times ")
    .replace(/…/g, "")
    .replace(/\$([0-9.]+)M/g, "$1 million dollars")
    .replace(/\s+/g, " ")
    .trim();
}
