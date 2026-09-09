// Macro/market news source — lightweight RSS fetch + parse (no dependency).

export interface NewsItem { title: string; link: string; published?: string }

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'");
}

/** Fetch + normalize items from one or more RSS feeds. Broken feeds are skipped. */
export async function fetchNews(feeds: string[], limit = 15): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const url of feeds) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "alpha402/0.1" } });
      if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<item[\s\S]*?<\/item>/gi)) {
        const block = m[0];
        const title = decode(tag(block, "title"));
        if (!title) continue;
        out.push({ title, link: decode(tag(block, "link")), published: tag(block, "pubDate") || undefined });
      }
    } catch { /* skip a broken feed */ }
  }
  // newest first, across all feeds
  out.sort((a, b) => (b.published ? Date.parse(b.published) || 0 : 0) - (a.published ? Date.parse(a.published) || 0 : 0));
  return out.slice(0, limit);
}
