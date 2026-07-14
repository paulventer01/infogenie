"use client";

// Native React port of the legacy `hashtag-tracker` panel (was
// `window.buildHashtagTracker` + `#view-hashtag-tracker` in index.html /
// public/js/ig_brand24_suite.js). Tracks hashtags across platforms and scans
// them for velocity, reach and top influencers against the existing Express API
// (`GET`/`POST /api/hashtag-tracker/watches`,
// `DELETE /api/hashtag-tracker/watches/:id`,
// `POST /api/hashtag-tracker/scan/:id`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete, type ApiResult } from "@/lib/api";

interface Watch {
  id: number;
  hashtag: string;
  platforms?: string[];
}
interface WatchesResult {
  rows?: Watch[];
}
interface Influencer {
  username?: string;
  platform?: string;
  followers?: number;
  engagement_rate?: string;
}
interface TopPost {
  author?: string;
  platform?: string;
  text?: string;
}
interface ScanResult extends ApiResult {
  hashtag?: string;
  velocity?: string;
  total_posts?: number;
  estimated_reach?: number;
  sentiment_pos?: number;
  sentiment_neg?: number;
  top_influencers?: Influencer[];
  top_posts?: TopPost[];
}

function fmtNum(n: unknown) {
  return Number(n || 0).toLocaleString("en-US");
}
function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={"badge bg-" + cls}>{label}</span>;
}

export default function HashtagTracker() {
  const [rows, setRows] = useState<Watch[]>([]);
  const [tag, setTag] = useState("");
  const [tw, setTw] = useState(true);
  const [ig, setIg] = useState(true);
  const [tt, setTt] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  async function loadWatches() {
    const w = await apiGet<WatchesResult>("/api/hashtag-tracker/watches");
    setRows(w.rows || []);
  }

  useEffect(() => {
    loadWatches();
  }, []);

  async function add() {
    const t = tag.trim();
    if (!t) return;
    const platforms: string[] = [];
    if (tw) platforms.push("twitter");
    if (ig) platforms.push("instagram");
    if (tt) platforms.push("tiktok");
    await apiPost("/api/hashtag-tracker/watches", { hashtag: t, platforms });
    setTag("");
    loadWatches();
  }

  async function del(id: number) {
    await apiDelete("/api/hashtag-tracker/watches/" + id);
    loadWatches();
  }

  async function scan(id: number) {
    setScanning(true);
    setError("");
    setResult(null);
    const d = await apiPost<ScanResult>("/api/hashtag-tracker/scan/" + id, {});
    setScanning(false);
    if (!d.ok) {
      setError(d.error || "Failed");
      return;
    }
    setResult(d);
  }

  const velCls =
    result?.velocity === "rising"
      ? "success"
      : result?.velocity === "falling"
        ? "danger"
        : "secondary";

  return (
    <div id="hashtagTrackerWrap">
      <div className="row g-4">
        <div className="col-12 col-lg-4">
          <div className="card mb-4">
            <div className="card-body">
              <h5 className="card-title">Track a Hashtag</h5>
              <label className="form-label fw-semibold">Hashtag (without #)</label>
              <input
                className="form-control mb-3"
                placeholder="e.g. buildinpublic"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
              <label className="form-label fw-semibold small">Platforms</label>
              <div className="d-flex gap-3 mb-3 small">
                <label>
                  <input
                    type="checkbox"
                    checked={tw}
                    onChange={(e) => setTw(e.target.checked)}
                  />{" "}
                  Twitter/X
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={ig}
                    onChange={(e) => setIg(e.target.checked)}
                  />{" "}
                  Instagram
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tt}
                    onChange={(e) => setTt(e.target.checked)}
                  />{" "}
                  TikTok
                </label>
              </div>
              <button className="btn btn-outline-primary w-100" onClick={add}>
                + Add to Watchlist
              </button>
            </div>
          </div>
          <div className="card">
            <div className="card-body">
              <h5 className="card-title">Watchlist</h5>
              <div>
                {rows.length ? (
                  rows.map((w) => (
                    <div
                      key={w.id}
                      className="d-flex justify-content-between align-items-center py-2 border-bottom"
                    >
                      <div>
                        <strong>#{w.hashtag}</strong>
                        <br />
                        <span className="small text-muted">
                          {(w.platforms || []).join(", ")}
                        </span>
                      </div>
                      <div className="d-flex gap-1">
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => scan(w.id)}
                        >
                          Scan
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => del(w.id)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="small text-muted">No hashtags tracked yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-8">
          <div className="card">
            <div className="card-body">
              <h5 className="card-title">Latest Scan</h5>
              <div>
                {scanning ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary"></div>
                    <p className="mt-2 text-muted">Analysing with AI…</p>
                  </div>
                ) : error ? (
                  <div className="alert alert-danger">{error}</div>
                ) : result ? (
                  <>
                    <h5>
                      #{result.hashtag}{" "}
                      <Pill label={result.velocity || "stable"} cls={velCls} />
                    </h5>
                    <div className="row g-3 mb-4">
                      <div className="col-4">
                        <div className="card text-center p-3">
                          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                            {fmtNum(result.total_posts)}
                          </div>
                          <div className="small text-muted">Posts</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="card text-center p-3">
                          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                            {fmtNum(result.estimated_reach)}
                          </div>
                          <div className="small text-muted">Est. Reach</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="card text-center p-3">
                          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                            <span className="text-success">
                              {result.sentiment_pos || 0}%
                            </span>{" "}
                            /{" "}
                            <span className="text-danger">
                              {result.sentiment_neg || 0}%
                            </span>
                          </div>
                          <div className="small text-muted">+/−</div>
                        </div>
                      </div>
                    </div>
                    {result.top_influencers && result.top_influencers.length ? (
                      <>
                        <h6>Top Influencers</h6>
                        <div className="table-responsive">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Account</th>
                                <th>Platform</th>
                                <th>Followers</th>
                                <th>Engagement</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.top_influencers.map((i, idx) => (
                                <tr key={idx}>
                                  <td>@{i.username || ""}</td>
                                  <td>{i.platform || ""}</td>
                                  <td>{fmtNum(i.followers)}</td>
                                  <td>{i.engagement_rate || ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}
                    {result.top_posts && result.top_posts.length ? (
                      <>
                        <h6 className="mt-3">Top Posts</h6>
                        {result.top_posts.slice(0, 4).map((p, idx) => (
                          <div
                            key={idx}
                            className="border rounded p-2 mb-2 small"
                          >
                            <strong>{p.author || ""}</strong> · {p.platform || ""}
                            <br />
                            {p.text || ""}
                          </div>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="text-center py-5 text-muted">
                    <p>Select a hashtag and click Scan.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
