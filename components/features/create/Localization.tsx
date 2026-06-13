"use client";

// Native React port of the legacy `localization` panel (`buildLocalization` +
// `#view-localization` in index.html, builder in app.js). This is a CLIENT-SIDE
// SIMULATION (the legacy panel makes no API calls): it reads the last analysed
// site from `window.analysisData` / localStorage to derive the brand, lets the
// user pick a language preset, and "translates" with a short simulated delay —
// faithfully reproducing the legacy behaviour (no fabricated server data).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goToView } from "@/lib/nav";

interface Lang {
  code: string;
  name: string;
  flag: string;
  speakers: string;
}

const LANGS: Lang[] = [
  { code: "es", name: "Spanish", flag: "🇪🇸", speakers: "500M" },
  { code: "fr", name: "French", flag: "🇫🇷", speakers: "280M" },
  { code: "de", name: "German", flag: "🇩🇪", speakers: "130M" },
  { code: "it", name: "Italian", flag: "🇮🇹", speakers: "85M" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹", speakers: "260M" },
  { code: "nl", name: "Dutch", flag: "🇳🇱", speakers: "24M" },
  { code: "pl", name: "Polish", flag: "🇵🇱", speakers: "45M" },
  { code: "sv", name: "Swedish", flag: "🇸🇪", speakers: "10M" },
  { code: "da", name: "Danish", flag: "🇩🇰", speakers: "6M" },
  { code: "no", name: "Norwegian", flag: "🇳🇴", speakers: "5M" },
  { code: "fi", name: "Finnish", flag: "🇫🇮", speakers: "5M" },
  { code: "cs", name: "Czech", flag: "🇨🇿", speakers: "10M" },
  { code: "el", name: "Greek", flag: "🇬🇷", speakers: "13M" },
  { code: "tr", name: "Turkish", flag: "🇹🇷", speakers: "85M" },
  { code: "ru", name: "Russian", flag: "🇷🇺", speakers: "255M" },
  { code: "uk", name: "Ukrainian", flag: "🇺🇦", speakers: "40M" },
  { code: "ar", name: "Arabic", flag: "🇸🇦", speakers: "420M" },
  { code: "he", name: "Hebrew", flag: "🇮🇱", speakers: "9M" },
  { code: "fa", name: "Persian", flag: "🇮🇷", speakers: "70M" },
  { code: "hi", name: "Hindi", flag: "🇮🇳", speakers: "600M" },
  { code: "bn", name: "Bengali", flag: "🇧🇩", speakers: "270M" },
  { code: "ur", name: "Urdu", flag: "🇵🇰", speakers: "170M" },
  { code: "ta", name: "Tamil", flag: "🇮🇳", speakers: "80M" },
  { code: "th", name: "Thai", flag: "🇹🇭", speakers: "70M" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳", speakers: "85M" },
  { code: "id", name: "Indonesian", flag: "🇮🇩", speakers: "200M" },
  { code: "ms", name: "Malay", flag: "🇲🇾", speakers: "80M" },
  { code: "tl", name: "Filipino", flag: "🇵🇭", speakers: "45M" },
  { code: "ja", name: "Japanese", flag: "🇯🇵", speakers: "125M" },
  { code: "ko", name: "Korean", flag: "🇰🇷", speakers: "80M" },
  { code: "zh", name: "Mandarin", flag: "🇨🇳", speakers: "1.1B" },
  { code: "yue", name: "Cantonese", flag: "🇭🇰", speakers: "85M" },
  { code: "sw", name: "Swahili", flag: "🇰🇪", speakers: "150M" },
  { code: "am", name: "Amharic", flag: "🇪🇹", speakers: "30M" },
  { code: "zu", name: "Zulu", flag: "🇿🇦", speakers: "12M" },
  { code: "af", name: "Afrikaans", flag: "🇿🇦", speakers: "7M" },
  { code: "ro", name: "Romanian", flag: "🇷🇴", speakers: "25M" },
  { code: "hu", name: "Hungarian", flag: "🇭🇺", speakers: "13M" },
  { code: "sk", name: "Slovak", flag: "🇸🇰", speakers: "5M" },
  { code: "bg", name: "Bulgarian", flag: "🇧🇬", speakers: "8M" },
  { code: "hr", name: "Croatian", flag: "🇭🇷", speakers: "5M" },
];

const TOP10 = ["es", "fr", "de", "pt", "it", "nl", "ja", "ko", "zh", "ar"];
const EU = [
  "es", "fr", "de", "it", "pt", "nl", "pl", "sv", "da", "no", "fi", "cs",
  "el", "ro", "hu",
];
const ALL = LANGS.map((l) => l.code);

const SAMPLES: Record<string, string> = {
  es: "Prueba ${brand} gratis 14 días — sin tarjeta",
  fr: "Essayez ${brand} gratuitement 14 jours — sans carte",
  de: "Testen Sie ${brand} 14 Tage gratis — ohne Karte",
  it: "Prova ${brand} gratis per 14 giorni — senza carta",
  pt: "Experimente ${brand} grátis por 14 dias — sem cartão",
  nl: "Probeer ${brand} 14 dagen gratis — geen kaart nodig",
  ja: "${brand}を14日間無料でお試し — カード不要",
  ko: "14일 무료 ${brand} 체험 — 카드 불필요",
  zh: "免费试用${brand} 14天 — 无需信用卡",
  ar: "جرّب ${brand} مجانًا لمدة 14 يومًا — بدون بطاقة",
  hi: "${brand} को 14 दिन फ्री आज़माएँ — कार्ड की ज़रूरत नहीं",
  ru: "Попробуйте ${brand} бесплатно 14 дней — без карты",
};

interface AnalysisData {
  url?: string;
  domain?: string;
  brand?: string;
  brandName?: string;
}

function getAD(): AnalysisData | null {
  const w = window as unknown as { analysisData?: AnalysisData };
  if (w.analysisData) return w.analysisData;
  try {
    const url = localStorage.getItem("ig-last-analysed-url");
    if (url) return { url };
  } catch {
    /* ignore */
  }
  return null;
}

function lsDomain(): string {
  const ad = getAD();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}

function lsBrand(): string {
  const ad = getAD();
  return (
    (ad && (ad.brand || ad.brandName)) ||
    lsDomain().split(".")[0] ||
    "your brand"
  );
}

function toast(msg: string) {
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

interface LocData {
  langs: string[];
  statusByLang: Record<string, "done" | "inprog" | "queued">;
  done: number;
  inProgress: number;
  reach: string;
}

export default function Localization() {
  const router = useRouter();
  const hasAnalysis = typeof window !== "undefined" && !!lsDomain();
  const [data, setData] = useState<LocData | null>(null);
  const [busy, setBusy] = useState(false);

  const brand = hasAnalysis ? lsBrand() : "your brand";
  const baseHeadline = `Try ${brand} free for 14 days — no card needed`;

  function run(preset: "top10" | "eu" | "all") {
    if (!lsDomain()) {
      toast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      const sel = preset === "all" ? ALL : preset === "eu" ? EU : TOP10;
      const statusByLang: Record<string, "done" | "inprog" | "queued"> = {};
      const inProgressIdx = Math.min(2, sel.length);
      sel.forEach((c, i) => {
        statusByLang[c] =
          i < sel.length - inProgressIdx
            ? "done"
            : i < sel.length - 1
              ? "inprog"
              : "queued";
      });
      const done = sel.filter((c) => statusByLang[c] === "done").length;
      const inProg = sel.filter((c) => statusByLang[c] === "inprog").length;
      setData({
        langs: sel,
        statusByLang,
        done,
        inProgress: inProg,
        reach: sel.length > 30 ? "4.2B" : sel.length > 12 ? "2.8B" : "1.4B",
      });
      setBusy(false);
      toast(`✅ ${sel.length} languages localized`);
    }, 1400);
  }

  const header = (
    <div className="view-header">
      <div className="container">
        <div className="vh-inner">
          <div>
            <div className="breadcrumb">
              <span className="bc-group">Create</span>{" "}
              <span className="bc-sep">›</span> International Localization
            </div>
            <h2 className="view-title">🌍 International Localization</h2>
            <p className="view-sub">
              Localise your headlines and CTAs into 40+ languages with
              locale-aware tone, currency and idioms.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  if (!hasAnalysis) {
    return (
      <div className="view-header-wrap">
        {header}
        <div className="container">
          <div
            style={{
              background: "white",
              border: "2px dashed #CBD5E1",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
              marginTop: 20,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              Run an analysis first
            </h3>
            <p
              style={{
                margin: "0 auto 18px",
                color: "#64748B",
                maxWidth: 480,
              }}
            >
              International Localization needs your competitor &amp; sector data.
              Head to the home page, enter your website (or pick a sector), and
              we&apos;ll have everything ready in under a minute.
            </p>
            <button
              className="btn-primary"
              onClick={() => goToView(router, "home")}
              style={{
                background: "linear-gradient(135deg,#0066FF,#00D8D7)",
                color: "white",
                border: "none",
                padding: "10px 22px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ↗ Go to Home — Run Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      {header}
      <div className="container" style={{ paddingBottom: 56 }}>
        {!data ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              border: "1px solid #E2E8F0",
              marginTop: 16,
            }}
          >
            <h3 style={{ margin: "0 0 6px", color: "#1E293B" }}>
              Pick languages to localise into
            </h3>
            <p
              style={{
                margin: "0 0 14px",
                color: "#64748B",
                fontSize: 14,
              }}
            >
              All 40+ supported. Each language gets locale-aware tone, currency,
              idioms and CTAs.
            </p>
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => run("top10")}
                disabled={busy}
                style={{
                  padding: "7px 14px",
                  background: "#6366F1",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ⚡ Quick: Top 10 (recommended)
              </button>
              <button
                onClick={() => run("eu")}
                disabled={busy}
                style={{
                  padding: "7px 14px",
                  background: "#1E40AF",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                🇪🇺 EU pack (15 langs)
              </button>
              <button
                onClick={() => run("all")}
                disabled={busy}
                style={{
                  padding: "7px 14px",
                  background: "#0F172A",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                🌍 All 40+
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
                gap: 6,
                maxHeight: 340,
                overflowY: "auto",
                background: "#F8FAFC",
                padding: 10,
                borderRadius: 8,
              }}
            >
              {LANGS.map((l) => (
                <div
                  key={l.code}
                  style={{
                    background: "white",
                    borderRadius: 6,
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{l.flag}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#1E293B", fontWeight: 600 }}>
                      {l.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#94A3B8" }}>
                      {l.speakers}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {(
                [
                  ["Languages", data.langs.length, "#6366F1"],
                  ["Translated", data.done, "#10B981"],
                  ["In progress", data.inProgress, "#F59E0B"],
                  ["Total reach", data.reach, "#0EA5E9"],
                ] as [string, string | number, string][]
              ).map((s) => (
                <div
                  key={s[0]}
                  style={{
                    background: "white",
                    borderRadius: 10,
                    padding: 14,
                    border: "1px solid #E2E8F0",
                    borderLeft: `3px solid ${s[2]}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748B",
                      fontWeight: 700,
                      letterSpacing: ".05em",
                    }}
                  >
                    {s[0]}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#1E293B",
                      marginTop: 3,
                    }}
                  >
                    {s[1]}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #E2E8F0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #E2E8F0",
                  background: "#F8FAFC",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: "#1E293B" }}>
                    Source headline
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#475569",
                      marginTop: 3,
                    }}
                  >
                    &quot;{baseHeadline}&quot;
                  </div>
                </div>
                <button
                  onClick={() => setData(null)}
                  style={{
                    padding: "7px 14px",
                    background: "#F1F5F9",
                    color: "#1E293B",
                    border: "1px solid #E2E8F0",
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  + Change Languages
                </button>
              </div>
              <div style={{ maxHeight: 560, overflowY: "auto" }}>
                {data.langs.map((code) => {
                  const l =
                    LANGS.find((x) => x.code === code) ||
                    ({ flag: "🏳", name: code, speakers: "" } as Lang);
                  const trans = (
                    SAMPLES[code] ||
                    `[${l.name}] Try \${brand} free 14 days — no card`
                  ).replace(/\$\{brand\}/g, brand);
                  const status = data.statusByLang[code];
                  return (
                    <div
                      key={code}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "140px 1fr 130px",
                        gap: 14,
                        padding: "12px 18px",
                        borderBottom: "1px solid #F1F5F9",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 22 }}>{l.flag}</span>
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#1E293B",
                              fontSize: 13,
                            }}
                          >
                            {l.name}
                          </div>
                          <div style={{ fontSize: 10, color: "#94A3B8" }}>
                            {l.speakers}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#1E293B",
                          fontStyle: status === "done" ? "normal" : "italic",
                          opacity: status === "done" ? 1 : 0.55,
                        }}
                      >
                        {status === "done"
                          ? trans
                          : "(translation pending…)"}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {status === "done" ? (
                          <span
                            style={{
                              color: "#10B981",
                              fontWeight: 800,
                              fontSize: 11,
                              background: "#F0FDF4",
                              padding: "4px 10px",
                              borderRadius: 99,
                            }}
                          >
                            ✓ Translated
                          </span>
                        ) : status === "inprog" ? (
                          <span
                            style={{
                              color: "#92400E",
                              fontWeight: 800,
                              fontSize: 11,
                              background: "#FEF3C7",
                              padding: "4px 10px",
                              borderRadius: 99,
                            }}
                          >
                            ⚙ Translating…
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "#64748B",
                              fontWeight: 600,
                              fontSize: 11,
                              background: "#F1F5F9",
                              padding: "4px 10px",
                              borderRadius: 99,
                            }}
                          >
                            Queued
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                onClick={() => toast("✓ All translations exported as .po files")}
                style={{
                  padding: "9px 18px",
                  background: "#6366F1",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ⬇ Export .po files
              </button>
              <button
                onClick={() => toast("✓ Pushed to landing pages")}
                style={{
                  padding: "9px 18px",
                  background: "#F1F5F9",
                  color: "#1E293B",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                📤 Push to Landing Pages
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
