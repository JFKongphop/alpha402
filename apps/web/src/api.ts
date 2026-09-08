import { useEffect, useState } from "react";

const BASE = (import.meta as any).env?.VITE_API ?? "/api";

export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Poll an endpoint on an interval; returns the latest value (or null before first load). */
export function usePoll<T>(path: string, ms = 20000): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiGet<T>(path);
      if (alive && r != null) setData(r);
    };
    void tick();
    const h = setInterval(() => void tick(), ms);
    return () => { alive = false; clearInterval(h); };
  }, [path, ms]);
  return data;
}
