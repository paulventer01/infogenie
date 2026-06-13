"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../../styles/auth.module.css";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let t = "";
    try {
      t = new URLSearchParams(window.location.search).get("token") || "";
    } catch {
      t = "";
    }
    setToken(t);
    if (!t)
      setErr("Missing reset token in URL. Use the link from the email exactly.");
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
        "/api/auth/reset-password/" + encodeURIComponent(token),
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        },
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error || "Could not reset password.");
        setBusy(false);
        return;
      }
      setOk("Password updated. Redirecting you to sign in…");
      window.setTimeout(() => {
        window.location.href = "/login?reset=1";
      }, 900);
    } catch {
      setErr("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${styles.cardNarrow}`}>
      <div className={`${styles.head} ${styles.headCompact}`}>
        <h1 className={styles.headTitle}>Reset your password</h1>
        <p className={styles.headSub}>
          Choose a new password for your InfoGenie account.
        </p>
      </div>
      <div className={styles.body}>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <label className={styles.label} htmlFor="pw">
            New password
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
          <div className={`${styles.hint} ${styles.hintLarge}`}>
            Use a passphrase you don&apos;t reuse elsewhere.
          </div>
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
          {err && <div className={`${styles.err} ${styles.feedbackTop}`}>{err}</div>}
          {ok && <div className={`${styles.notice} ${styles.feedbackTop}`}>{ok}</div>}
          <button
            className={`${styles.submit} ${styles.submitSpaced}`}
            type="submit"
            disabled={busy}
          >
            {busy ? "Saving…" : "Set new password →"}
          </button>
        </form>
        <Link className={styles.back} href="/">
          ← Back to InfoGenie
        </Link>
      </div>
    </div>
  );
}
