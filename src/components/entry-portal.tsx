"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLines, Database, Plus } from "lucide-react";
import "./entry-portal.css";

const satellites = [
  { x: 320, y: 70, r: 27 },
  { x: 525, y: 180, r: 35 },
  { x: 547, y: 420, r: 25 },
  { x: 342, y: 555, r: 36 },
  { x: 112, y: 457, r: 28 },
  { x: 90, y: 208, r: 33 },
];

export function EntryPortal({
  connected,
  checking,
  onEnter,
}: {
  connected: boolean;
  checking: boolean;
  onEnter: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    // This percentage measures the entry animation, not database or agent work.
    const tick = (now: number) => {
      const fraction = Math.min((now - start) / (reducedMotion ? 1 : 2200), 1);
      setProgress(Math.round(fraction * 100));
      if (fraction < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  useEffect(
    () => () => {
      if (transition.current) clearTimeout(transition.current);
    },
    [],
  );

  function enter() {
    if (progress < 100 || leaving) return;
    setLeaving(true);
    transition.current = setTimeout(onEnter, reducedMotion ? 0 : 650);
  }

  return (
    <div
      className={`entry-screen ${leaving ? "entry-leaving" : ""}`}
      onPointerMove={(event) => {
        if (reducedMotion || event.pointerType === "touch") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--pointer-x",
          `${(event.clientX / bounds.width - 0.5) * 12}deg`,
        );
        event.currentTarget.style.setProperty(
          "--pointer-y",
          `${(event.clientY / bounds.height - 0.5) * -10}deg`,
        );
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--pointer-x", "0deg");
        event.currentTarget.style.setProperty("--pointer-y", "0deg");
      }}
    >
      <header className="entry-header">
        <a
          href="/workspace"
          className="entry-brand"
          aria-label="Aftershock home"
        >
          <AudioLines size={29} />
          <span>
            AFTERSHOCK<span className="entry-brand-period">.</span>
          </span>
        </a>
        <div className="entry-navigation">
          <span className="entry-edition">
            GRAPH HACKS <span>/</span> 2026
          </span>
        </div>
      </header>

      <section
        className="entry-stage"
        aria-label="Enter the incident workspace"
      >
        <h1 className="entry-wordmark">AFTERSHOCK</h1>
        <div className="entry-art" aria-hidden="true">
          <div className="entry-aura" />
          <svg viewBox="0 0 640 640" className="entry-network">
            <defs>
              <radialGradient id="core-fill" cx="30%" cy="23%" r="85%">
                <stop offset="0" stopColor="#f1f9df" />
                <stop offset=".35" stopColor="#b7d899" />
                <stop offset=".68" stopColor="#73966a" />
                <stop offset="1" stopColor="#304e43" />
              </radialGradient>
              <radialGradient id="node-fill" cx="27%" cy="20%" r="90%">
                <stop offset="0" stopColor="#fffef7" />
                <stop offset=".35" stopColor="#d2e1bf" />
                <stop offset="1" stopColor="#688666" />
              </radialGradient>
              <radialGradient id="origin-fill" cx="28%" cy="22%" r="85%">
                <stop offset="0" stopColor="#fff0d5" />
                <stop offset=".4" stopColor="#edb68d" />
                <stop offset="1" stopColor="#ab654e" />
              </radialGradient>
              <linearGradient id="link-fill" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#9dbba0" />
                <stop offset="1" stopColor="#496d54" />
              </linearGradient>
              <filter
                id="node-shadow"
                x="-70%"
                y="-70%"
                width="240%"
                height="240%"
              >
                <feDropShadow
                  dx="0"
                  dy="9"
                  stdDeviation="10"
                  floodColor="#36513d"
                  floodOpacity=".14"
                />
              </filter>
            </defs>
            <g
              className="entry-orbits"
              fill="none"
              stroke="#93aa85"
              strokeWidth=".8"
            >
              <ellipse
                cx="320"
                cy="320"
                rx="288"
                ry="218"
                transform="rotate(-33 320 320)"
              />
              <ellipse
                cx="320"
                cy="320"
                rx="183"
                ry="298"
                transform="rotate(31 320 320)"
              />
              <circle cx="320" cy="320" r="258" strokeDasharray="2 11" />
            </g>
            <g
              className="entry-links"
              stroke="url(#link-fill)"
              fill="none"
              strokeWidth="2"
            >
              {satellites.map((node, index) => (
                <g
                  key={index}
                  style={{ opacity: progress >= index * 14 ? 0.8 : 0.12 }}
                >
                  <path
                    d={`M320 320 Q${(320 + node.x) / 2 + 30} ${(320 + node.y) / 2 - 30} ${node.x} ${node.y}`}
                  />
                  <path
                    d={`M${node.x} ${node.y} L${satellites[(index + 1) % satellites.length].x} ${satellites[(index + 1) % satellites.length].y}`}
                    strokeWidth=".8"
                    strokeOpacity=".4"
                  />
                </g>
              ))}
            </g>
            <circle
              className="entry-shockwave"
              cx="320"
              cy="320"
              r="150"
              fill="none"
              stroke="#779d65"
              strokeWidth="1"
            />
            <circle
              className="entry-shockwave second-wave"
              cx="320"
              cy="320"
              r="150"
              fill="none"
              stroke="#779d65"
              strokeWidth="1"
            />
            <circle
              cx="320"
              cy="320"
              r="154"
              fill="url(#core-fill)"
              filter="url(#node-shadow)"
            />
            <ellipse
              cx="320"
              cy="320"
              rx="147"
              ry="56"
              transform="rotate(-34 320 320)"
              fill="none"
              stroke="#e9f3d6"
              strokeWidth=".8"
              opacity=".5"
            />
            <ellipse
              cx="320"
              cy="320"
              rx="72"
              ry="153"
              transform="rotate(-34 320 320)"
              fill="none"
              stroke="#e9f3d6"
              strokeWidth=".8"
              opacity=".3"
            />
            <path
              d="M255 283h25l14-29 20 54 15-35 11 10h43"
              className="entry-heartbeat"
              stroke="#eff8df"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {satellites.map((node, index) => (
              <g
                key={index}
                className="entry-satellite"
                style={
                  {
                    "--satellite-delay": `${index * -0.55}s`,
                    opacity: progress >= index * 14 ? 1 : 0.25,
                  } as CSSProperties
                }
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={index === 0 ? "url(#origin-fill)" : "url(#node-fill)"}
                  filter="url(#node-shadow)"
                />
                <circle
                  cx={node.x - node.r * 0.25}
                  cy={node.y - node.r * 0.3}
                  r={node.r * 0.17}
                  fill="#fff"
                  opacity=".6"
                />
              </g>
            ))}
            <g
              className="entry-node-captions"
              fill="#617159"
              fontFamily="monospace"
              fontSize="9"
              letterSpacing="1.4"
              textAnchor="middle"
            >
              <text x="320" y="27">
                THE SIGNAL
              </text>
              <text x="560" y="128">
                THE IMPACT
              </text>
              <text x="342" y="616">
                THE CONTEXT
              </text>
            </g>
          </svg>
          <span className="entry-art-caption">
            ONE SIGNAL. EVERY CONNECTION.
          </span>
        </div>

        <div className="entry-control">
          <button
            className="entry-enter"
            disabled={progress < 100 || leaving}
            onClick={enter}
            aria-label={
              progress < 100
                ? `Preparing interface ${progress}%`
                : "Enter investigation"
            }
          >
            <span>
              {leaving ? (
                "Opening workspace"
              ) : progress < 100 ? (
                <>
                  Loading{" "}
                  <span className="entry-percentage">
                    {String(progress).padStart(2, "0")}%
                  </span>
                </>
              ) : (
                "Enter investigation"
              )}
            </span>
            <Plus size={22} aria-hidden="true" />
          </button>
          <div
            className="entry-progress"
            role="progressbar"
            aria-label="Interface preparation"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ transform: `scaleX(${progress / 100})` }} />
          </div>
          <span className="entry-ready" role="status">
            {progress < 100
              ? "Preparing your workspace"
              : "100% ready · Click to enter"}
          </span>
        </div>
      </section>

      <footer className="entry-footer">
        <div>
          <span className="entry-case">
            INC-247 <span>/</span> NOVA COMMERCE
          </span>
          <p>A failed deploy. A connected investigation.</p>
        </div>
        <div className="entry-footer-right">
          <span
            className={`entry-db-status ${connected ? "is-connected" : ""}`}
          >
            <Database size={15} />
            {checking
              ? "Connecting to FalkorDB"
              : connected
                ? "FalkorDB connected"
                : "Offline · workspace preview"}
          </span>
          <span className="entry-data-note">
            SYNTHETIC SCENARIO · REAL GRAPH CONTEXT
          </span>
        </div>
      </footer>
    </div>
  );
}
