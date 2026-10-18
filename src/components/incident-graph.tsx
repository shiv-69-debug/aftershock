"use client";

import { useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { GraphNode, GraphSnapshot, NodeKind } from "@/lib/types";

const colors: Record<NodeKind, string> = {
  Evidence: "#74816a",
  Service: "#667c85",
  Deployment: "#b36c50",
  Team: "#89729f",
  Customer: "#568596",
  Incident: "#6d8758",
  Constraint: "#b18c42",
};

export function IncidentGraph({
  graph,
  selected,
  onSelect,
  highlighted,
  running,
  path,
}: {
  graph: GraphSnapshot;
  selected: string | null;
  onSelect: (node: GraphNode) => void;
  highlighted: string[];
  running: boolean;
  path?: string[];
}) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className={`graph-canvas ${running ? "graph-running" : ""}`}>
      <div className="graph-coordinate">TOPOLOGY / checkout-production</div>
      <svg
        viewBox="-35 0 930 630"
        role="img"
        aria-label="Interactive service dependency graph. Select a node to inspect its source evidence."
      >
        <defs>
          <pattern
            id="dots"
            width="22"
            height="22"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 22 0 L 0 0 0 22"
              fill="none"
              stroke="#e9eee1"
              strokeWidth="0.8"
            />
          </pattern>
          <marker
            id="arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#596259" />
          </marker>
          <marker
            id="block-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#b18c42" />
          </marker>
        </defs>
        <rect x="-35" width="930" height="630" fill="url(#dots)" />
        <g transform={`translate(430 315) scale(${zoom}) translate(-430 -315)`}>
          <circle cx="430" cy="225" r="160" className="blast-ring" />
          <circle cx="430" cy="225" r="260" className="blast-ring outer" />
          {graph.edges.map((edge) => {
            const a = graph.nodes.find((n) => n.id === edge.source);
            const b = graph.nodes.find((n) => n.id === edge.target);
            if (!a || !b) return null;
            const dx = b.x - a.x,
              dy = b.y - a.y,
              length = Math.hypot(dx, dy);
            const x1 = a.x + (dx / length) * 29,
              y1 = a.y + (dy / length) * 29;
            const x2 = b.x - (dx / length) * 35,
              y2 = b.y - (dy / length) * 35;
            const blocked = edge.relation === "BLOCKS";
            const active = path?.length
              ? path.some(
                  (id, index) => id === a.id && path[index + 1] === b.id,
                )
              : highlighted.includes(a.id) && highlighted.includes(b.id);
            return (
              <g
                key={`${edge.source}-${edge.target}`}
                className={active ? "edge-active" : ""}
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={blocked ? "#b18c42" : active ? "#799a62" : "#bdc9b4"}
                  strokeWidth={blocked || active ? 1.8 : 1}
                  strokeDasharray={blocked ? "5 5" : undefined}
                  markerEnd={blocked ? "url(#block-arrow)" : "url(#arrow)"}
                />
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 9}
                  className="edge-label"
                  fill={blocked ? "#a28143" : "#7e8c73"}
                >
                  {edge.relation.toLowerCase().replaceAll("_", " ")}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const active = selected === node.id;
            const isRoot = node.id === "checkout";
            const color = isRoot ? colors.Deployment : colors[node.kind];
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className={`graph-node ${active ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${node.name}, ${node.kind}. Inspect evidence`}
                onClick={() => onSelect(node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(node);
                  }
                }}
              >
                {(active || isRoot) && (
                  <circle
                    r="37"
                    fill="none"
                    stroke={color}
                    strokeOpacity="0.25"
                    strokeDasharray={isRoot ? "3 5" : undefined}
                    className={isRoot ? "root-halo" : ""}
                  />
                )}
                <circle
                  r="27"
                  fill={isRoot ? "#fff4ed" : "#ffffff"}
                  stroke={color}
                  strokeOpacity={active ? 1 : 0.55}
                  strokeWidth={active ? 2 : 1}
                />
                <g
                  stroke={color}
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {node.kind === "Service" && (
                    <>
                      <rect x="-9" y="-10" width="18" height="8" rx="2" />
                      <rect x="-9" y="2" width="18" height="8" rx="2" />
                      <path d="M-5 -6h1m-1 12h1" />
                    </>
                  )}
                  {node.kind === "Deployment" && (
                    <>
                      <path d="m0 -12 10 6v12L0 12-10 6V-6Z M-10 -6 0 0l10-6 M0 0v12 M-5 -9l10 6" />
                    </>
                  )}
                  {node.kind === "Team" && (
                    <>
                      <circle cx="-3" cy="-5" r="4" />
                      <path d="M-11 10V6q8-10 16 0v4 M5-9q9 3 3 8 M8 2q7 1 7 8" />
                    </>
                  )}
                  {node.kind === "Customer" && (
                    <>
                      <rect x="-8" y="-10" width="16" height="21" rx="2" />
                      <path d="M-4 -5h1m5 0h1M-4 0h1m5 0h1M-2 11V6h4v5" />
                    </>
                  )}
                  {node.kind === "Incident" && (
                    <>
                      <path d="M-9-10h14l5 5v16H-9Z M5-10v6h5 M-4 1h9M-4 6h6" />
                    </>
                  )}
                  {node.kind === "Constraint" && (
                    <>
                      <path d="m0-12 12 22h-24Z M0-4v6 M0 6v1" />
                    </>
                  )}
                </g>
                <text
                  y="47"
                  fill={active ? "#34492b" : "#56644b"}
                  className="node-label"
                >
                  {node.name}
                </text>
                <text
                  y="62"
                  fill={isRoot ? colors.Deployment : "#87977a"}
                  className="node-type"
                >
                  {isRoot ? "INCIDENT ORIGIN" : node.kind.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graph-legend">
        <span>
          <i style={{ background: colors.Deployment }} />
          Origin
        </span>
        <span>
          <i style={{ background: colors.Service }} />
          Service
        </span>
        <span>
          <i style={{ background: colors.Customer }} />
          Customer
        </span>
        <span>
          <i style={{ background: colors.Team }} />
          Owner
        </span>
        <span>
          <i style={{ background: colors.Incident }} />
          Memory
        </span>
      </div>
      <div className="graph-controls">
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.65, z - 0.15))}
        >
          <Minus size={15} />
        </button>
        <button aria-label="Reset graph zoom" onClick={() => setZoom(1)}>
          <Maximize2 size={14} />
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
