// Display names for feeds. The feed id (whale-radar, volume-radar, …) stays the
// routing key everywhere in the code; these are what humans read. Dropped the
// repeated "radar" — each label names its own signal instead.
const FEED_LABELS: Record<string, string> = {
  "whale-radar": "whale-flow",
  "volume-radar": "volume-momentum",
  "macro-news": "macro-news",
  "alpha-brief": "alpha-brief",
};

export function feedLabel(id?: string | null): string {
  if (!id) return "";
  return FEED_LABELS[id] ?? id;
}
