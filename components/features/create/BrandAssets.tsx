"use client";

// Native React port of the legacy `brand-assets` panel (was `initBrandAssets`
// + `baLoadAssets` / `baRender` / `baFilterTag` / `baHandleFiles` / `baPreview`
// / `baDelete` / `baRemoveBg` in public/js/ig_drip_serp.js +
// `#view-brand-assets` in index.html). Manages the brand creative library via
// the existing Express API:
//   GET    /api/creatives/list
//   POST   /api/creatives/upload   (multipart: files[] + tag)
//   DELETE /api/creatives/:id
//   POST   /api/tools/remove-bg    { image_url }
// JSON calls use `lib/api`; the multipart upload uses a raw XHR for progress.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Asset {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  tag?: string;
}
interface ListResult {
  ok?: boolean;
  assets?: Asset[];
}
interface UploadResult {
  files?: { id?: string }[];
}
interface RemoveBgResult {
  ok: boolean;
  error?: string;
  result_b64?: string;
}

const TAGS = ["all", "Logo", "Banner", "Video", "Social", "Print", "General"];
const TAG_LABELS: Record<string, string> = {
  all: "All",
  Logo: "Logos",
  Banner: "Banners",
  Video: "Video",
  Social: "Social",
  Print: "Print",
  General: "General",
};

export default function BrandAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeTag, setActiveTag] = useState("all");
  const [query, setQuery] = useState("");
  const [uploadTag, setUploadTag] = useState("General");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadAssets() {
    const data = await apiGet<ListResult>("/api/creatives/list");
    setAssets(data.assets || []);
  }

  useEffect(() => {
    loadAssets();
  }, []);

  function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    form.append("tag", uploadTag);
    setProgress({ pct: 10, label: `Uploading ${files.length} file(s)…` });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/creatives/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress({
          pct: Math.round((e.loaded / e.total) * 90),
          label: `Uploading ${files.length} file(s)…`,
        });
      }
    };
    xhr.onload = () => {
      let result: UploadResult = {};
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON response */
      }
      const n = result.files?.length || 0;
      setProgress({ pct: 100, label: `✅ ${n} file(s) uploaded` });
      setStatus(`✅ ${n} brand asset(s) uploaded`);
      setTimeout(() => setProgress(null), 1800);
      loadAssets();
    };
    xhr.onerror = () => {
      setProgress({ pct: 100, label: "⚠ Upload failed" });
      setTimeout(() => setProgress(null), 3000);
    };
    xhr.send(form);
    if (fileInput.current) fileInput.current.value = "";
  }

  function preview(asset: Asset) {
    if (asset.type === "video" || asset.type === "document") {
      window.open(asset.url, "_blank");
      return;
    }
    setLightbox(asset);
  }

  async function del(asset: Asset) {
    if (!window.confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    await apiDelete("/api/creatives/" + encodeURIComponent(asset.id));
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    setStatus("Asset deleted");
  }

  async function removeBg(asset: Asset) {
    setStatus("⏳ Removing background…");
    const d = await apiPost<RemoveBgResult>("/api/tools/remove-bg", {
      image_url: asset.url,
    });
    if (!d.ok || !d.result_b64) {
      setStatus("⚠ " + (d.error || "Remove BG failed"));
      return;
    }
    const byteArr = Uint8Array.from(atob(d.result_b64), (c) => c.charCodeAt(0));
    const blob = new Blob([byteArr], { type: "image/png" });
    const newName = asset.name.replace(/\.[^.]+$/, "") + "_no_bg.png";
    const file = new File([blob], newName, { type: "image/png" });
    const form = new FormData();
    form.append("files", file);
    form.append("tag", asset.tag || "No BG");
    await fetch("/api/creatives/upload", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    setStatus(`✅ Background removed — saved as "${newName}"`);
    loadAssets();
  }

  const q = query.toLowerCase();
  const shown = assets.filter((a) => {
    const matchTag = activeTag === "all" || (a.tag || "General") === activeTag;
    const matchQ =
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.tag || "").toLowerCase().includes(q);
    return matchTag && matchQ;
  });
  const imageCount = assets.filter((a) => a.type === "image").length;
  const videoCount = assets.filter((a) => a.type === "video").length;

  function sizeStr(size: number) {
    return size > 1048576
      ? (size / 1048576).toFixed(1) + " MB"
      : Math.round(size / 1024) + " KB";
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Brand Assets
              </div>
              <h2 className="view-title">Brand Creative Library</h2>
              <p className="view-sub">
                Upload logos, banners, videos and ad creatives — available across
                all campaigns
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={() => fileInput.current?.click()}
              >
                ⬆ Upload Assets
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="ba-toolbar">
          <div className="ba-tag-filters">
            {TAGS.map((t) => (
              <button
                key={t}
                className={"ba-tag" + (activeTag === t ? " active" : "")}
                onClick={() => setActiveTag(t)}
              >
                {TAG_LABELS[t]}
              </button>
            ))}
          </div>
          <input
            className="ba-search"
            type="text"
            placeholder="Search assets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div
          className={"ba-dropzone" + (dragOver ? " drag-over" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.svg"
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="ba-dz-text">
            Drag &amp; drop brand assets here, or{" "}
            <button
              className="ba-dz-link"
              onClick={() => fileInput.current?.click()}
            >
              browse files
            </button>
          </p>
          <p className="ba-dz-hint">
            JPG · PNG · GIF · WebP · MP4 · MOV · PDF · SVG &nbsp;·&nbsp; Up to 50
            MB per file
          </p>
          <div className="ba-tag-select-wrap">
            <label className="ba-tag-label">Tag uploads as:</label>
            <select
              className="ba-tag-select"
              value={uploadTag}
              onChange={(e) => setUploadTag(e.target.value)}
            >
              <option>General</option>
              <option>Logo</option>
              <option>Banner</option>
              <option>Video</option>
              <option>Social</option>
              <option>Print</option>
            </select>
          </div>
        </div>

        {progress && (
          <div className="ba-progress-wrap">
            <div className="ba-progress-bar" style={{ width: progress.pct + "%" }} />
            <div className="ba-progress-label">{progress.label}</div>
          </div>
        )}

        {status && (
          <div
            style={{ margin: "10px 0", fontSize: "0.82rem", color: "#4A5670" }}
          >
            {status}
          </div>
        )}

        <div className="ba-stats">
          <span>
            <strong>{assets.length}</strong> total assets
          </span>
          <span>
            <strong>{shown.length}</strong> shown
          </span>
          <span>
            <strong>{imageCount}</strong> images
          </span>
          <span>
            <strong>{videoCount}</strong> videos
          </span>
        </div>

        <div className="ba-grid">
          {!shown.length ? (
            <div className="ba-empty">
              <p>
                {assets.length
                  ? "No assets match your filter"
                  : "No brand assets yet — upload your first creative above"}
              </p>
            </div>
          ) : (
            shown.map((a) => (
              <div className="ba-card" id={"ba-card-" + a.id} key={a.id}>
                {a.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="ba-card-thumb"
                    src={a.url}
                    alt={a.name}
                    loading="lazy"
                  />
                ) : a.type === "video" ? (
                  <div className="ba-card-thumb-icon">🎬</div>
                ) : a.type === "document" ? (
                  <div className="ba-card-thumb-icon">📄</div>
                ) : (
                  <div className="ba-card-thumb-icon">🖼️</div>
                )}
                <div className="ba-card-body">
                  <div className="ba-card-name" title={a.name}>
                    {a.name}
                  </div>
                  <div className="ba-card-meta">
                    <span>{sizeStr(a.size)}</span>
                    <span className="ba-card-tag">{a.tag || "General"}</span>
                  </div>
                </div>
                <div className="ba-card-actions">
                  <button
                    className="ba-card-btn ba-card-btn-view"
                    onClick={() => preview(a)}
                  >
                    Preview
                  </button>
                  {a.type === "image" && (
                    <button
                      className="ba-card-btn"
                      style={{
                        background: "#F5F3FF",
                        color: "#7B68EE",
                        borderColor: "#DDD6FE",
                      }}
                      onClick={() => removeBg(a)}
                    >
                      🪄 Remove BG
                    </button>
                  )}
                  <button
                    className="ba-card-btn ba-card-btn-del"
                    onClick={() => del(a)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {lightbox && (
        <div className="ba-lightbox" onClick={() => setLightbox(null)}>
          <div className="ba-lightbox-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ba-lightbox-img"
              src={lightbox.url}
              alt={lightbox.name}
            />
            <button
              className="ba-lightbox-close"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(null);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
