// macro-news → a clean news feed (list), not a canvas. News is text, so it reads
// as a scannable list of headline · time · link — no graph chrome.

function fmtTime(published?: string): string {
  if (!published) return "";
  const d = new Date(published);
  if (isNaN(+d)) return published;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MacroNews({ data }: { data: any[] }) {
  const items = (Array.isArray(data) ? data : []).filter((n) => n && n.title);
  if (items.length === 0) return <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--ash)" }}>No headlines in this result.</div>;

  return (
    <div className="card newsfeed">
      {items.map((n, i) => {
        const href = n.link && /^https?:\/\//.test(n.link) ? n.link : undefined;
        const Row: any = href ? "a" : "div";
        return (
          <Row key={i} className="newsrow" {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}>
            <div className="news-l">
              <div className="news-title">{n.title}</div>
              {n.published && <div className="news-time">{fmtTime(n.published)}</div>}
            </div>
            {href && <span className="news-arrow">↗</span>}
          </Row>
        );
      })}
    </div>
  );
}
