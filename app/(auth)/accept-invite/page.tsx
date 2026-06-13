"use client";

import { useEffect, useState } from "react";
import styles from "../../../styles/auth.module.css";

interface Invite {
  email?: string;
  workspace?: string;
  role?: string;
  name?: string;
  hasPassword?: boolean;
}

export default function AcceptInvitePage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [inviteHtml, setInviteHtml] = useState("");

  function esc(s: unknown): string {
    return String(s || "").replace(
      /[&<>"]/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c,
    );
  }

  useEffect(() => {
    let t = "";
    try {
      t = new URLSearchParams(window.location.search).get("token") || "";
    } catch {
      t = "";
    }
    setToken(t);
    if (!t) {
      setErr(
        "Missing invite token in URL. Use the link from the email exactly.",
      );
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/invite/" + encodeURIComponent(t), {
          credentials: "same-origin",
        });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setErr((j && j.error) || "This invite link is invalid or has expired.");
          setDisabled(true);
          return;
        }
        const inv: Invite = j.invite || {};
        if (inv.name) setName(inv.name);
        const parts: string[] = [];
        if (inv.email) parts.push("Inviting <b>" + esc(inv.email) + "</b>");
        if (inv.workspace) parts.push("to <b>" + esc(inv.workspace) + "</b>");
        if (inv.role) parts.push("as <b>" + esc(inv.role) + "</b>");
        if (parts.length) setInviteHtml(parts.join(" "));
      } catch {
        /* non-fatal — the accept call will surface errors */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setErr("");
    setOk("");
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setErr("The two passwords don\u2019t match.");
      return;
    }
    if (!token) return;
    setBusy(true);
    try {
      const r = await fetch(
        "/api/auth/accept-invite/" + encodeURIComponent(token),
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw, name }),
        },
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error || "Could not accept invite.");
        setBusy(false);
        return;
      }
      setOk("You\u2019re in! Redirecting you to InfoGenie…");
      window.setTimeout(() => {
        window.location.href = "/";
      }, 900);
    } catch {
      setErr("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${styles.cardNarrow}`}>
      <div className={`${styles.head} ${styles.headCompact}`}>
        <h1 className={styles.headTitle}>Accept your invite</h1>
        <p className={styles.headSub}>Join your team on InfoGenie.</p>
      </div>
      <div className={styles.body}>
        {inviteHtml && (
          <div
            className={styles.invite}
            dangerouslySetInnerHTML={{ __html: inviteHtml }}
          />
        )}
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <label className={styles.label} htmlFor="nm">
            Your name
          </label>
          <input
            id="nm"
            className={styles.input}
            type="text"
            autoComplete="name"
            placeholder="e.g. Jordan Lee"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
          />
          <label className={`${styles.label} ${styles.fieldSpaced}`} htmlFor="pw">
            Choose a password
          </label>
          <input
            id="pw"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={pw}
            onChange={(ev) => setPw(ev.target.value)}
          />
          <label
            className={`${styles.label} ${styles.fieldSpaced}`}
            htmlFor="pw2"
          >
            Confirm password
          </label>
          <input
            id="pw2"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="Repeat it"
            value={pw2}
            onChange={(ev) => setPw2(ev.target.value)}
          />
          <div className={`${styles.hint} ${styles.hintLarge}`}>
            Use a passphrase you don&apos;t reuse elsewhere.
          </div>
          {err && <div className={`${styles.err} ${styles.feedbackTop}`}>{err}</div>}
          {ok && <div className={`${styles.notice} ${styles.feedbackTop}`}>{ok}</div>}
          <button
            className={`${styles.submit} ${styles.submitSpaced}`}
            type="submit"
            disabled={busy || disabled}
          >
            {busy ? "Saving…" : "Accept & create account →"}
          </button>
        </form>
        <a className={styles.back} href="/">
          ← Back to InfoGenie
        </a>
      </div>
    </div>
  );
}
