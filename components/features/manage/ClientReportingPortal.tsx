"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { API, accessLost, responseError } from "@/lib/clientReporting";
import {
  inviteUrl, validPortalResponse, type InviteResponse, type PortalResponse,
} from "@/lib/clientReportingPortal";

type Props = { clientId: number; checkAccess: () => Promise<boolean>; clearContext: (message: string) => void };
const card = { marginTop: 20, padding: 20, border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFFFFF" };
const button = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", marginRight: 8, marginTop: 8 };

export default function ClientReportingPortal({ clientId, checkAccess, clearContext }: Props) {
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const live = useRef(false), sequence = useRef(0);
  const stop = useCallback(() => { live.current = false; ++sequence.current; }, []);
  useEffect(() => { live.current = true; return stop; }, [stop, clientId]);

  const load = useCallback(async () => {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setBusy(true); setError(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiGet<PortalResponse>(`${API}/${clientId}/portal`);
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validPortalResponse(result, clientId)) throw new Error(failure || "Portal access could not be loaded.");
      if (!await checkAccess() || !current()) return;
      setEnabled(result.portal!.enabled);
      setPending(result.portal!.pending_invitations);
      setSessions(result.portal!.active_sessions);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Portal access could not be loaded.");
    } finally { if (current()) setBusy(false); }
  }, [checkAccess, clearContext, clientId]);

  useEffect(() => { void load(); }, [load]);

  async function createInvite() {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setActing(true); setError(null); setNotice(null); setInviteLink(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiPost<InviteResponse>(`${API}/${clientId}/portal/invitations`, {});
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !result.invite_path || !result.invitation) {
        throw new Error(failure === "profile_required"
          ? "Save a reporting profile before creating a portal invitation."
          : failure || "Portal invitation could not be created.");
      }
      if (!await checkAccess() || !current()) return;
      const url = inviteUrl(result.invite_path);
      setInviteLink(url);
      setEnabled(true);
      setPending((value) => value + 1);
      setNotice("Single-use invitation created. Copy the link now — it will not be shown again.");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Portal invitation could not be created.");
    } finally { if (current()) setActing(false); }
  }

  async function revoke() {
    const operation = ++sequence.current, current = () => live.current && operation === sequence.current;
    setActing(true); setError(null); setNotice(null); setInviteLink(null);
    try {
      if (!await checkAccess() || !current()) return;
      const result = await apiPost<PortalResponse>(`${API}/${clientId}/portal/revoke`, {});
      if (!current()) return;
      const failure = responseError(result);
      if (failure && accessLost(failure)) clearContext(failure);
      if (failure || !validPortalResponse(result, clientId)) throw new Error(failure || "Portal access could not be revoked.");
      if (!await checkAccess() || !current()) return;
      setEnabled(result.portal!.enabled);
      setPending(result.portal!.pending_invitations);
      setSessions(result.portal!.active_sessions);
      setNotice("Portal access revoked. Pending invitations and active sessions were invalidated.");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Portal access could not be revoked.");
    } finally { if (current()) setActing(false); }
  }

  return <section aria-label="Client reporting portal access" style={card}>
    <h2>Client reporting portal</h2>
    <p>Create a single-use invitation link for this client. After redemption they can view the latest report snapshot and delivery history in a read-only portal session.</p>
    {busy && <p role="status">Loading portal status…</p>}
    {!busy && <>
      <p>Status: {enabled ? "Active" : "No active portal access"} · Pending invitations: {pending} · Active sessions: {sessions}</p>
      <button style={button} disabled={acting} onClick={() => void createInvite()}>Create invitation link</button>
      <button style={{ ...button, background: "#B91C1C" }} disabled={acting || (!enabled && pending === 0 && sessions === 0)} onClick={() => void revoke()}>
        Revoke portal access
      </button>
      {inviteLink && <div style={{ marginTop: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          Invitation link (single use)
          <input readOnly value={inviteLink} aria-label="Portal invitation link" style={{ border: "1px solid #94A3B8", borderRadius: 6, padding: 9 }} />
        </label>
        <button style={button} onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy link</button>
      </div>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
