"use client";

// Native React port of the legacy `infographics` panel (was
// `window.buildInfographics` in public/js/ig_manage_pack.js + `#view-infographics`).
// Napkin-style text → SVG infographic generator with SVG/PNG export and history,
// against the existing Express API (`GET /api/infographics/list`,
// `POST /api/infographics/generate`) via lib/api. SVG is rendered in JSX (no
// innerHTML); export serialises the live SVG node via XMLSerializer.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Palette {
  primary?: string;
  accent?: string;
  text?: string;
}
interface InfoItem {
  label: string;
  value?: string;
  detail?: string;
}
interface Infographic {
  id?: string;
  title?: string;
  subtitle?: string;
  takeaway?: string;
  topic?: string;
  layout?: string;
  palette?: Palette;
  items?: InfoItem[];
  source?: string;
}

const LAYOUTS = ["funnel", "list", "comparison", "journey", "quadrant", "pyramid", "cycle"];
const W = 800;
const H = 500;

function safeId(s: string | undefined): string {
  return (
    String(s || "infographic")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40) || "infographic"
  );
}

function SvgBody({ d }: { d: Infographic }) {
  const pal: Required<Palette> = {
    primary: d.palette?.primary || "#0066FF",
    accent: d.palette?.accent || "#7C3AED",
    text: d.palette?.text || "#0A1628",
  };
  const items = d.items || [];
  const layout = d.layout;

  if (layout === "funnel") {
    const max = items.length;
    const step = (H - 160) / max;
    return (
      <>
        {items.map((it, i) => {
          const top = 120 + i * step;
          const ww = W - 160 - i * (((W - 160) / max) * 0.6);
          const x = (W - ww) / 2;
          const taper = ((W - 160) / max) * 0.6 / 2;
          return (
            <g key={i}>
              <polygon
                points={`${x},${top} ${x + ww},${top} ${x + ww - taper},${top + step - 10} ${
                  x + taper
                },${top + step - 10}`}
                fill={i % 2 ? pal.accent : pal.primary}
                opacity={0.5 + i * 0.08}
              />
              <text
                x={W / 2}
                y={top + step / 2}
                textAnchor="middle"
                fill="#fff"
                fontWeight="800"
                fontSize="16"
              >
                {it.label}
              </text>
              <text
                x={W / 2}
                y={top + step / 2 + 18}
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                opacity="0.9"
              >
                {it.value || ""}
              </text>
            </g>
          );
        })}
      </>
    );
  }

  if (layout === "comparison") {
    const cw = (W - 100) / 2;
    return (
      <>
        {items.slice(0, 2).map((it, i) => (
          <g key={i}>
            <rect
              x={50 + i * cw}
              y={120}
              width={cw - 10}
              height={H - 160}
              fill={i ? pal.accent : pal.primary}
              rx={12}
            />
            <text
              x={50 + i * cw + cw / 2}
              y={160}
              textAnchor="middle"
              fill="#fff"
              fontWeight="800"
              fontSize="22"
            >
              {it.label}
            </text>
            <text
              x={50 + i * cw + cw / 2}
              y={200}
              textAnchor="middle"
              fill="#fff"
              fontSize="14"
              opacity="0.9"
            >
              {it.value || ""}
            </text>
            <foreignObject x={60 + i * cw} y={220} width={cw - 30} height={H - 260}>
              <div
                {...{ xmlns: "http://www.w3.org/1999/xhtml" }}
                style={{ color: "#fff", fontSize: 13, lineHeight: 1.5 }}
              >
                {it.detail || ""}
              </div>
            </foreignObject>
          </g>
        ))}
      </>
    );
  }

  if (layout === "quadrant") {
    return (
      <>
        <line x1={W / 2} y1={100} x2={W / 2} y2={H - 40} stroke="#E5E7EB" strokeWidth="2" />
        <line x1={60} y1={(H + 60) / 2} x2={W - 60} y2={(H + 60) / 2} stroke="#E5E7EB" strokeWidth="2" />
        {items.slice(0, 4).map((it, i) => {
          const cx = i % 2 ? (3 * W) / 4 : W / 4;
          const cy = i < 2 ? (H + 60) / 4 + 60 : ((H + 60) * 3) / 4 + 30;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={60} fill={i % 2 ? pal.accent : pal.primary} opacity="0.85" />
              <text x={cx} y={cy} textAnchor="middle" fill="#fff" fontWeight="800" fontSize="14">
                {it.label}
              </text>
              <text x={cx} y={cy + 18} textAnchor="middle" fill="#fff" fontSize="11">
                {it.value || ""}
              </text>
            </g>
          );
        })}
      </>
    );
  }

  if (layout === "pyramid") {
    const max = items.length;
    const step = (H - 160) / max;
    return (
      <>
        {items.map((it, i) => {
          const top = 120 + i * step;
          const lvl = i + 1;
          const ww = 200 + lvl * ((W - 300) / max);
          const x = (W - ww) / 2;
          return (
            <g key={i}>
              <rect
                x={x}
                y={top}
                width={ww}
                height={step - 8}
                fill={i % 2 ? pal.accent : pal.primary}
                rx={6}
                opacity={1 - i * 0.1}
              />
              <text
                x={W / 2}
                y={top + step / 2}
                textAnchor="middle"
                fill="#fff"
                fontWeight="800"
                fontSize="15"
              >
                {it.label}
              </text>
            </g>
          );
        })}
      </>
    );
  }

  if (layout === "cycle") {
    const cx = W / 2;
    const cy = H / 2 + 20;
    const r = 160;
    return (
      <>
        {items.map((it, i) => {
          const a = (i / items.length) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={55} fill={i % 2 ? pal.accent : pal.primary} />
              <text x={x} y={y} textAnchor="middle" fill="#fff" fontWeight="800" fontSize="13">
                {it.label}
              </text>
              <text x={x} y={y + 16} textAnchor="middle" fill="#fff" fontSize="10">
                {it.value || ""}
              </text>
            </g>
          );
        })}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={pal.primary}
          strokeWidth="2"
          strokeDasharray="6 6"
          opacity="0.4"
        />
      </>
    );
  }

  if (layout === "journey") {
    const step = (W - 120) / items.length;
    return (
      <>
        <line x1={60} y1={H / 2} x2={W - 60} y2={H / 2} stroke={pal.primary} strokeWidth="3" />
        {items.map((it, i) => {
          const x = 60 + step * i + step / 2;
          return (
            <g key={i}>
              <circle cx={x} cy={H / 2} r={38} fill={i % 2 ? pal.accent : pal.primary} />
              <text x={x} y={H / 2 + 5} textAnchor="middle" fill="#fff" fontWeight="800" fontSize="14">
                {i + 1}
              </text>
              <text
                x={x}
                y={H / 2 - 55}
                textAnchor="middle"
                fill={pal.text}
                fontWeight="700"
                fontSize="13"
              >
                {it.label}
              </text>
              <text x={x} y={H / 2 + 75} textAnchor="middle" fill="#6B7280" fontSize="11">
                {it.value || ""}
              </text>
            </g>
          );
        })}
      </>
    );
  }

  // default: list
  return (
    <>
      {items.map((it, i) => (
        <g key={i}>
          <rect
            x={60}
            y={120 + i * 65}
            width={W - 120}
            height={55}
            fill={i % 2 ? pal.accent : pal.primary}
            rx={8}
            opacity="0.92"
          />
          <text x={80} y={152 + i * 65} fill="#fff" fontWeight="800" fontSize="16">
            {i + 1}. {it.label}
          </text>
          <text
            x={W - 80}
            y={152 + i * 65}
            textAnchor="end"
            fill="#fff"
            fontSize="13"
            opacity="0.9"
          >
            {it.value || ""}
          </text>
        </g>
      ))}
    </>
  );
}

export default function Infographics() {
  const [topic, setTopic] = useState("");
  const [layout, setLayout] = useState("funnel");
  const [count, setCount] = useState("5");
  const [current, setCurrent] = useState<{ d: Infographic; id: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<Infographic[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  async function loadHistory() {
    const j = await apiGet<{ items?: Infographic[] }>("/api/infographics/list");
    setHistory(j.items || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const j = await apiGet<{ items?: Infographic[] }>("/api/infographics/list");
      if (cancelled) return;
      setHistory(j.items || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function generate() {
    const t = topic.trim();
    if (!t) {
      alert("Topic required");
      return;
    }
    setStatus("⏳ Designing…");
    setGenerating(true);
    const j = await apiPost<{
      ok: boolean;
      infographic?: Infographic;
      id?: string;
      error?: string;
      message?: string;
      data_unavailable?: boolean;
    }>("/api/infographics/generate", {
      topic: t,
      layout,
      itemCount: parseInt(count, 10) || 5,
    });
    setGenerating(false);
    if (j.data_unavailable || !j.ok || !j.infographic) {
      setCurrent(null);
      setStatus(
        j.message ||
          j.error ||
          "Generation unavailable — add an OpenAI key in Settings, or try again.",
      );
      return;
    }
    setStatus(
      j.infographic.source === "layout-scaffold"
        ? "Layout scaffold ready — add an AI key in Settings for a full topic-specific design."
        : null,
    );
    setCurrent({ d: j.infographic, id: j.id || "infographic" });
    loadHistory();
  }

  function downloadSvg() {
    if (!svgRef.current) return;
    const svgStr = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = safeId(current?.id) + ".svg";
    a.click();
    URL.revokeObjectURL(u);
  }

  function downloadPng() {
    if (!svgRef.current) return;
    const svgStr = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 1000;
      const x = c.getContext("2d");
      if (x) {
        x.fillStyle = "#fff";
        x.fillRect(0, 0, 1600, 1000);
        x.drawImage(img, 0, 0, 1600, 1000);
        const a = document.createElement("a");
        a.href = c.toDataURL("image/png");
        a.download = safeId(current?.id) + ".png";
        a.click();
      }
      URL.revokeObjectURL(u);
    };
    img.src = u;
  }

  function openHistory(it: Infographic) {
    setCurrent({ d: it, id: it.id || "infographic" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const d = current?.d;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span>{" "}
                Infographic Generator
              </div>
              <h2 className="view-title">📊 Infographic Generator</h2>
              <p className="view-sub">
                Text → visual. Funnels, comparisons, journeys, pyramids, cycles — generated on-brand
                and exported as PNG/SVG for social, decks and landing pages.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              TOPIC
            </label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. The 5 stages of a B2B sales funnel"
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              LAYOUT
            </label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            >
              {LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              ITEMS
            </label>
            <input
              type="number"
              min={3}
              max={7}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={generate}
            disabled={generating}
            style={{
              background: "linear-gradient(135deg,#7C3AED,#A855F7)",
              color: "#fff",
              border: 0,
              padding: "10px 22px",
              borderRadius: 7,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✨ Generate
          </button>
        </div>

        <div>
          {status && (
            <div
              style={{
                color:
                  status === "⏳ Designing…" || status.startsWith("Layout scaffold")
                    ? "#6B7280"
                    : "#DC2626",
                marginBottom: 12,
                fontSize: "0.875rem",
              }}
            >
              {status}
            </div>
          )}
          {d && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                marginBottom: 18,
              }}
            >
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${W} ${H}`}
                style={{
                  width: "100%",
                  maxWidth: 900,
                  height: "auto",
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                }}
              >
                <text
                  x={W / 2}
                  y={50}
                  textAnchor="middle"
                  fill={d.palette?.text || "#0A1628"}
                  fontWeight="900"
                  fontSize="26"
                  fontFamily="Sora,sans-serif"
                >
                  {d.title || ""}
                </text>
                {d.subtitle && (
                  <text x={W / 2} y={78} textAnchor="middle" fill="#6B7280" fontSize="14">
                    {d.subtitle}
                  </text>
                )}
                <SvgBody d={d} />
                <text
                  x={W / 2}
                  y={H - 15}
                  textAnchor="middle"
                  fill={d.palette?.accent || "#7C3AED"}
                  fontSize="12"
                  fontStyle="italic"
                >
                  {d.takeaway || ""}
                </text>
              </svg>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={downloadSvg}
                  style={{
                    background: "#0066FF",
                    color: "#fff",
                    border: 0,
                    padding: "8px 16px",
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⬇ SVG
                </button>
                <button
                  onClick={downloadPng}
                  style={{
                    background: "#7C3AED",
                    color: "#fff",
                    border: 0,
                    padding: "8px 16px",
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⬇ PNG
                </button>
              </div>
            </div>
          )}
        </div>

        <h3 style={{ margin: "24px 0 10px", color: "#0A1628", fontFamily: "Sora,sans-serif" }}>
          📚 Recent
        </h3>
        <div>
          {history && history.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>No infographics yet.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: 10,
              }}
            >
              {(history || []).map((it, i) => (
                <div
                  key={i}
                  onClick={() => openHistory(it)}
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: 12,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0A1628" }}>
                    {it.title || it.topic || "Untitled"}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 4 }}>
                    {it.layout} · {(it.items || []).length} items
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
