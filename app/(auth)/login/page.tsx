"use client";

import { useEffect, useState, useCallback } from "react";
import styles from "../../../styles/auth.module.css";

type Mode = "login" | "signup";

const PRETTY: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  microsoft: "Microsoft",
};

const ICONS: Record<string, string> = {
  google:
    '<svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>',
  facebook:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38h-3.04V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z"/></svg>',
  microsoft:
    '<svg width="16" height="16" viewBox="0 0 23 23"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/><path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/></svg>',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ApiResponse {
  error?: string;
  providers?: Record<string, boolean>;
  [k: string]: unknown;
}

async function api(path: string, opts?: RequestInit): Promise<ApiResponse> {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(opts || {}),
  });
  const ct = r.headers.get("content-type") || "";
  const body: ApiResponse =
    ct.indexOf("application/json") !== -1
      ? await r.json().catch(() => ({}))
      : {};
  if (!r.ok) return { error: body.error || `Request failed (${r.status})` };
  return body;
}

// Where to send the user after a successful login/signup. Honors a `?next=`
// param so people land back on the view they were using. Only same-origin
// relative paths are accepted — protocol-relative `//`, absolute URLs and
// backslash tricks fall back to `/` to prevent open-redirects.
function nextDest(): string {
  try {
    const n = new URLSearchParams(window.location.search).get("next");
    if (!n) return "/";
    if (n.charAt(0) !== "/" || n.charAt(1) === "/" || n.charAt(1) === "\\")
      return "/";
    return n;
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  const showErr = useCallback((msg: string) => {
    setErr(msg);
    setNotice("");
  }, []);
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setErr("");
  }, []);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setErr("");
    setNotice("");
  }, []);

  // Load social providers, default tab, focus, and return-flow notices.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api("/api/auth/providers");
        const map = (r && r.providers) || {};
        const enabled = Object.keys(map).filter((k) => map[k]);
        if (!cancelled) setProviders(enabled);
      } catch {
        /* social row optional */
      }
    })();

    try {
      const sawLogin = localStorage.getItem("ig-saw-login");
      setMode(sawLogin ? "login" : "signup");
      localStorage.setItem("ig-saw-login", "1");
    } catch {
      setMode("login");
    }

    const focusTimer = window.setTimeout(() => {
      try {
        document.getElementById("email")?.focus();
      } catch {
        /* noop */
      }
    }, 100);

    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("verified") === "1") {
        setMode("login");
        showNotice("Email verified — you can log in now.");
      } else if (q.get("reset") === "1") {
        setMode("login");
        showNotice("Password updated — log in with your new password.");
      } else if (q.get("expired") === "1") {
        setMode("login");
        showNotice("Your session expired — please log in again.");
      } else if (q.get("social")) {
        setMode("login");
        showNotice(`Signed in with ${q.get("social")} — loading…`);
      }
    } catch {
      /* noop */
    }

    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [showNotice]);

  function startSocial(provider: string) {
    const dest = nextDest();
    let url = `/api/auth/oauth/${encodeURIComponent(provider)}/start`;
    if (dest && dest !== "/") url += `?next=${encodeURIComponent(dest)}`;
    window.location.href = url;
  }

  async function onForgot() {
    const e = (email || "").trim().toLowerCase();
    if (!e || !EMAIL_RE.test(e)) {
      showErr(
        "Type your email in the field above first, then click Forgot your password.",
      );
      return;
    }
    setForgotBusy(true);
    try {
      const r = await api("/api/auth/request-reset", {
        method: "POST",
        body: JSON.stringify({ email: e }),
      });
      if (r && r.error) showErr(r.error);
      else
        showNotice(
          "If that email is registered, a password-reset link is on its way. Check your inbox.",
        );
    } catch {
      showErr("Network error — could not request reset.");
    }
    setForgotBusy(false);
  }

  async function submit() {
    const e = (email || "").trim().toLowerCase();
    const p = pass || "";
    if (!e || !EMAIL_RE.test(e)) {
      showErr("Please enter a valid email address.");
      return;
    }
    if (!p) {
      showErr("Please enter your password.");
      return;
    }

    if (mode === "login") {
      setBusy(true);
      setBusyLabel("Signing in…");
      const r = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: e, password: p }),
      });
      if (r.error) {
        setBusy(false);
        showErr(r.error);
        return;
      }
      window.location.href = nextDest();
      return;
    }

    if (p.length < 10 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
      showErr("Password must be at least 10 characters with a letter and a number.");
      return;
    }
    setBusy(true);
    setBusyLabel("Creating account…");
    const dest = nextDest();
    const body: { name: string; email: string; password: string; next?: string } =
      { name: (name || "").trim(), email: e, password: p };
    if (dest && dest !== "/") body.next = dest;
    const s = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (s.error) {
      setBusy(false);
      showErr(s.error);
      return;
    }
    window.location.href = nextDest();
  }

  const submitLabel = busy
    ? busyLabel
    : mode === "signup"
      ? "Create account →"
      : "Log In →";

  return (
    <div className={styles.shell}>
      <section className={styles.hero} aria-label="InfoGenie">
        <div className={styles.brandMark}>
          <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true">
            <defs>
              <linearGradient id="igAuthLogo" x1="0" y1="0" x2="40" y2="40">
                <stop offset="0%" stopColor="#0F766E" />
                <stop offset="100%" stopColor="#0284C7" />
              </linearGradient>
            </defs>
            <circle cx="20" cy="20" r="20" fill="url(#igAuthLogo)" />
            <path
              d="M13 20 Q20 10 27 20 Q20 30 13 20Z"
              fill="white"
              opacity=".95"
            />
            <circle cx="20" cy="20" r="4" fill="white" />
          </svg>
          <span>
            Info<em>Genie</em>
          </span>
        </div>
        <h1 className={styles.heroTitle}>
          One workspace for marketing that moves.
        </h1>
        <p className={styles.heroLead}>
          InfoGenie turns competitor signals into campaigns, content, and clear
          reporting — without the tool sprawl.
        </p>
        <div className={styles.heroMeta}>
          <span>Compete</span>
          <span>Create</span>
          <span>Reach</span>
          <span>Grow</span>
        </div>
      </section>

      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>
          {mode === "signup" ? "Create your workspace" : "Welcome back"}
        </h2>
        <p className={styles.panelSub}>
          {mode === "signup"
            ? "Start with email — you can invite your team later."
            : "Sign in to continue to your dashboard."}
        </p>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${mode === "login" ? styles.tabOn : ""}`}
            onClick={() => switchMode("login")}
          >
            Log In
          </button>
          <button
            type="button"
            className={`${styles.tab} ${mode === "signup" ? styles.tabOn : ""}`}
            onClick={() => switchMode("signup")}
          >
            Create Account
          </button>
        </div>

        {providers.length > 0 && (
          <>
            <div className={styles.social}>
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => startSocial(p)}
                >
                  <span
                    dangerouslySetInnerHTML={{ __html: ICONS[p] || "" }}
                  />
                  <span>Continue with {PRETTY[p] || p}</span>
                </button>
              ))}
            </div>
            <div className={styles.divider}>
              <div className={styles.line} />
              <span>or email</span>
              <div className={styles.line} />
            </div>
          </>
        )}

        <form
          autoComplete="on"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          {mode === "signup" && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                className={styles.input}
                type="text"
                placeholder="Jane Smith"
                autoComplete="name"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
            </div>
          )}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pass">
              Password
            </label>
            <input
              id="pass"
              className={styles.input}
              type="password"
              placeholder="••••••••"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={pass}
              onChange={(ev) => setPass(ev.target.value)}
            />
            {mode === "signup" && (
              <div className={styles.hint}>
                At least 10 characters, with a letter and a number.
              </div>
            )}
          </div>
          {err && <div className={styles.err}>{err}</div>}
          {notice && <div className={styles.notice}>{notice}</div>}
          <button
            className={styles.submit}
            type="submit"
            disabled={busy}
          >
            {submitLabel}
          </button>
          <div className={styles.forgot}>
            <button type="button" disabled={forgotBusy} onClick={onForgot}>
              {forgotBusy ? "Sending…" : "Forgot your password?"}
            </button>
          </div>
        </form>
        <div className={styles.legal}>
          By continuing you agree that your settings &amp; campaigns will be
          saved to this account.
        </div>
      </div>
    </div>
  );
}
