"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

// React-owned account menu (avatar pill + dropdown + logout). Replaces the
// legacy app.js `wireUserMenu` DOM-id wiring for the Next.js dashboard shell:
// the session is read from `/api/auth/me`, and open/close + logout are handled
// here in React rather than by the replayed legacy bundle. The legacy markup is
// gone from this shell, so app.js's `wireUserMenu` finds no `#navUserMenu`/
// `#navUserBtn` and harmlessly bails — production's index.html still uses it.
interface SessionUser {
  id?: number;
  email: string;
  name?: string;
  isOwner?: boolean;
  emailVerified?: boolean;
}

interface MeResponse {
  ok: boolean;
  authenticated?: boolean;
  user?: SessionUser | null;
}

export default function AccountMenu() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [resendState, setResendState] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet<MeResponse>("/api/auth/me");
      if (cancelled) return;
      if (r.ok && r.authenticated && r.user) setUser(r.user);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the dropdown on any outside click (mirrors the legacy behaviour).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const onLogout = useCallback(async () => {
    const ok = window.confirm(
      "Log out? Your settings & campaigns will stay saved to this account and reload when you log back in.",
    );
    if (!ok) return;
    try {
      window._persistContent?.();
    } catch {
      /* legacy persistence not loaded — proceed with logout */
    }
    try {
      await apiPost("/api/auth/logout", {});
    } catch {
      /* network error — still clear local state and bounce to /login */
    }
    try {
      window._auth?._clearSession?.();
    } catch {
      /* legacy auth client not present */
    }
    window.location.href = "/login";
  }, []);

  const onResend = useCallback(async () => {
    setResendState("sending");
    const r = await apiPost("/api/auth/resend-verification", {});
    const sent =
      r.ok && (r.sent === true || r.alreadyVerified === true);
    setResendState(sent ? "sent" : "failed");
    setTimeout(() => setResendState(null), 2500);
  }, []);

  // Render nothing until the session is known, so we never flash a placeholder
  // "User"/"U" avatar (the bug this component fixes).
  if (!user) return null;

  const email = user.email || "";
  const name = (user.name || "").trim();
  const initial = (name || email || "U").trim().charAt(0).toUpperCase();
  const pillName = (name || email.split("@")[0] || "User").slice(0, 18);

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        title="Account"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "7px 12px",
          background: "linear-gradient(135deg,#1d4ed8,#0f766e)",
          border: "none",
          borderRadius: "12px",
          color: "white",
          fontSize: ".76rem",
          fontWeight: 800,
          cursor: "pointer",
          fontFamily: "var(--font-jakarta), Plus Jakarta Sans, sans-serif",
          boxShadow: "0 8px 18px rgba(29,78,216,.22)",
        }}
      >
        <span
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: "rgba(255,255,255,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: ".72rem",
            fontWeight: 800,
          }}
        >
          {initial}
        </span>
        <span
          style={{
            maxWidth: "120px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pillName}
        </span>
        <span style={{ fontSize: ".6rem", opacity: 0.8 }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: "220px",
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            boxShadow: "0 12px 28px rgba(0,0,0,.14)",
            padding: "10px",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #F3F4F6",
              marginBottom: "6px",
            }}
          >
            <div
              style={{ fontSize: ".82rem", fontWeight: 800, color: "#111827" }}
            >
              {name || "—"}
            </div>
            <div
              style={{
                fontSize: ".7rem",
                color: "#6B7280",
                marginTop: "2px",
                wordBreak: "break-all",
              }}
            >
              {email}
            </div>
          </div>
          {user.emailVerified === false && (
            <div
              style={{
                margin: "6px 0 10px",
                padding: "8px 10px",
                background: "#FFFBEB",
                border: "1px solid #FCD34D",
                borderRadius: "8px",
                fontSize: ".72rem",
                color: "#92400E",
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>
                Email not verified yet
              </div>
              <div style={{ marginBottom: "6px" }}>
                We sent a link to <strong>{email}</strong>. Didn&apos;t get it?
              </div>
              <button
                type="button"
                disabled={resendState === "sending"}
                onClick={(e) => {
                  e.stopPropagation();
                  onResend();
                }}
                style={{
                  background: "#0066FF",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: ".7rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {resendState === "sending"
                  ? "Sending…"
                  : resendState === "sent"
                    ? "✓ Sent!"
                    : resendState === "failed"
                      ? "Failed — try again"
                      : "Resend verification email"}
              </button>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onLogout();
            }}
            style={{
              width: "100%",
              padding: "9px 12px",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "8px",
              fontSize: ".78rem",
              fontWeight: 700,
              color: "#B91C1C",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            ↩ Log out
          </button>
        </div>
      )}
    </div>
  );
}
