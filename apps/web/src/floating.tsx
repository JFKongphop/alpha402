// Floating edges for React Flow — edges connect node borders toward each other's
// center, so a radial/network layout looks clean (no fixed top/bottom handles).
// Adapted from the official React Flow "floating edges" example for v12.

import { getBezierPath, BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";

function intersection(node: InternalNode, target: InternalNode) {
  const w = (node.measured?.width ?? 168) / 2;
  const h = (node.measured?.height ?? 50) / 2;
  const x2 = node.internals.positionAbsolute.x + w;
  const y2 = node.internals.positionAbsolute.y + h;
  const tx = target.internals.positionAbsolute.x + (target.measured?.width ?? 168) / 2;
  const ty = target.internals.positionAbsolute.y + (target.measured?.height ?? 50) / 2;
  const xx1 = (tx - x2) / (2 * w) - (ty - y2) / (2 * h);
  const yy1 = (tx - x2) / (2 * w) + (ty - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xf = a * xx1, yf = a * yy1;
  return { x: w * (xf + yf) + x2, y: h * (-xf + yf) + y2 };
}

export default function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle, labelBgStyle }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const sp = intersection(s, t);
  const tp = intersection(t, s);
  const [path, labelX, labelY] = getBezierPath({ sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, padding: "1px 5px", borderRadius: 6, background: (labelBgStyle as any)?.fill ?? "#fff", ...(labelStyle as any), pointerEvents: "all" }}>
            {label as any}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
