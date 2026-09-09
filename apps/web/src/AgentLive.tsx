import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "./api";
import { fetchSpeech, sayable } from "./tts";

// Watch the autonomous agent trade: it reads the market, decides what it needs,
// and pays for it itself on Hedera. Every "paid" line is a real settled tx.
// With Voice on, it speaks each decision/payment aloud (Paxa Labs TTS).
interface Entry {
  id: number; t: number;
  kind: "start" | "observe" | "decide" | "pay" | "insight" | "error";
  text: string; feed?: string; amountHbar?: number; hashscan?: string;
}
interface State { running: boolean; log: Entry[] }

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const GLYPH: Record<Entry["kind"], string> = { start: "●", observe: "·", decide: "→", pay: "✓", insight: "◆", error: "!" };
const SPEAK = new Set(["start", "decide", "pay", "insight"]); // skip the chatty "observe" scans

export default function AgentLive() {
  const [state, setState] = useState<State>({ running: false, log: [] });
  const [pending, setPending] = useState(false);
  const [voice, setVoice] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // --- speech queue (plays new lines one after another) ---
  const spokenRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopAudio() {
    queueRef.current = [];
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    playingRef.current = false;
  }
  function pump() {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (next == null) return;
    playingRef.current = true;
    void fetchSpeech(next).then((url) => {
      if (!url) { playingRef.current = false; pump(); return; }
      const a = new Audio(url);
      audioRef.current = a;
      const done = () => { URL.revokeObjectURL(url); playingRef.current = false; audioRef.current = null; pump(); };
      a.onended = done; a.onerror = done;
      a.play().catch(done);
    });
  }

  useEffect(() => {
    let alive = true;
    const tick = async () => { const s = await apiGet<State>("/agent"); if (alive && s) setState(s); };
    void tick();
    const h = setInterval(() => void tick(), 2500);
    return () => { alive = false; clearInterval(h); };
  }, []);

  // voice on: start speaking from here (skip backlog). voice off: stop.
  useEffect(() => {
    if (voice) spokenRef.current = Math.max(0, ...(state.log ?? []).map((e) => e.id));
    else stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  // enqueue newly-arrived speakable lines
  useEffect(() => {
    if (!voice) return;
    const chrono = [...(state.log ?? [])].reverse();
    const fresh = chrono.filter((e) => e.id > spokenRef.current);
    if (fresh.length) {
      spokenRef.current = chrono[chrono.length - 1].id;
      for (const e of fresh) if (SPEAK.has(e.kind)) queueRef.current.push(sayable(e.text));
      pump();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.log]);

  useEffect(() => () => stopAudio(), []); // stop on unmount

  const rows = [...(state.log ?? [])].reverse();
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [state.log?.length]);

  async function toggle() {
    setPending(true);
    const s = await apiPost<State>(state.running ? "/agent/stop" : "/agent/start");
    if (s) setState((prev) => ({ ...prev, running: s.running }));
    setPending(false);
  }

  const paid = rows.filter((e) => e.kind === "pay");
  const spent = paid.reduce((n, e) => n + (e.amountHbar ?? 0), 0);

  return (
    <div className="card agent">
      <div className="agent-bar">
        <div className="agent-ctrls">
          <button className={`btn dark run${state.running ? " on" : ""}`} onClick={toggle} disabled={pending}>
            {state.running ? "⏸ Pause agent" : "▶ Watch the agent trade"}
          </button>
          <button className={`btn voice${voice ? " on" : ""}`} onClick={() => setVoice((v) => !v)} title="Speak the agent's decisions aloud">
            {voice ? "🔊 Voice on" : "🔈 Voice off"}
          </button>
        </div>
        <div className="agent-meta">
          <span className={`live${state.running ? "" : " off"}`} />
          {state.running ? "live" : "idle"} · {paid.length} paid · {spent.toFixed(2)} ℏ on Hedera
        </div>
      </div>

      <div className="agent-log" ref={boxRef}>
        {rows.length === 0 && (
          <div className="muted" style={{ padding: 20 }}>
            Press ▶ the agent will start reading the market and paying for the data it needs, on its own.
          </div>
        )}
        {rows.map((e) => (
          <div className={`aline ${e.kind}`} key={e.id}>
            <span className="atime">{hhmm(e.t)}</span>
            <span className="aglyph">{GLYPH[e.kind]}</span>
            <span className="atext">
              {e.text}
              {e.hashscan && <a className="atx" href={e.hashscan} target="_blank" rel="noreferrer">tx ↗</a>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
