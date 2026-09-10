"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { apiDelete, apiGet, apiPost, type ApiResult } from "@/lib/api";
import { API, accessLost, responseError, validClient, type Client } from "@/lib/clientReporting";
import { validMappingPage, validMappingResult, type MappingPage, type MappingRecord, type MappingResult, type MappingSource } from "@/lib/clientReportingMappings";

type Props = { clientId: number; checkAccess: () => Promise<boolean>; clearContext: (message: string) => void };
const button: CSSProperties = { background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 14px", margin: "8px 8px 0 0" };

export default function ClientReportingMappings(props: Props) {
  const [source, setSource] = useState<MappingSource>("search-intel");
  return <section aria-label="Client reporting data mappings" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginTop: 20 }}>
    <h2>Client data mappings</h2>
    <p>Choose which records belong in this client&apos;s reports. Unassigned records are excluded. Each record can belong to one client.</p>
    <label style={{ display: "grid", gap: 6 }}>Mapping source
      <select name="mapping_source" value={source} onChange={(event) => {
        if (event.target.value === "search-intel" || event.target.value === "campaigns") setSource(event.target.value);
      }} style={{ padding: 9, width: "100%", background: "#FFFFFF", color: "#0F172A", border: "1px solid #94A3B8", borderRadius: 6 }}>
        <option value="search-intel">Search intelligence</option><option value="campaigns">Campaigns</option>
      </select>
    </label>
    <p>This selection does not change the saved reporting profile. {source === "search-intel"
      ? "Search queries are supported; search pulses and image scans are excluded."
      : "Advertising campaigns are supported; legacy campaign launches are excluded."}</p>
    <MappingRows key={source} {...props} source={source} />
  </section>;
}

function MappingRows({ clientId, source, checkAccess, clearContext }: Props & { source: MappingSource }) {
  const [rows, setRows] = useState<MappingRecord[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<MappingRecord | null>(null);
  const live = useRef(false), operation = useRef(0), running = useRef(false), requireReload = useRef(false);
  const stop = useCallback(() => { live.current = false; ++operation.current; }, []);

  const verifyClient = useCallback(async (current: () => boolean) => {
    if (!await checkAccess() || !current()) return false;
    const result = await apiGet<ApiResult & { client?: Client }>(`${API}/${clientId}`);
    if (!current()) return false;
    const failure = responseError(result);
    if (failure && accessLost(failure)) { clearContext(failure); return false; }
    if (!await checkAccess() || !current()) return false;
    if (failure || !validClient(result.client) || result.client.id !== clientId) {
      setRows([]); setCursor(null); setPending(null); requireReload.current = true; setLocked(true);
      setError(failure === "client_not_found" ? "This client is no longer available. Choose another active client."
        : "The selected client could not be verified. Reload mappings to try again.");
      return false;
    }
    return true;
  }, [checkAccess, clearContext, clientId]);

  const load = useCallback(async (after: number | null = null) => {
    if (running.current) return;
    running.current = true;
    const sequence = ++operation.current;
    const current = () => live.current && sequence === operation.current;
    setBusy(true); setPending(null); setNotice(null); setError(null);
    // A failed read cannot leave old rows available for mutations.
    requireReload.current = true; setLocked(true);
    if (!after) { setRows([]); setCursor(null); }
    try {
      if (!await verifyClient(current) || !current()) return;
      const result = await apiGet<MappingPage>(`/api/client-reporting/sources/${source}/records?limit=50${after ? `&cursor=${after}` : ""}`);
      if (!current()) return;
      const failure = responseError(result) || (!validMappingPage(result, source, after) ? "Mapping records could not be verified. Reload mappings to try again." : null);
      if (failure && accessLost(failure)) { clearContext(failure); return; }
      if (!await verifyClient(current) || !current()) return;
      if (failure) { setError(failure); return; }
      setRows((previous) => after ? [...previous, ...result.records!] : result.records!);
      setCursor(result.next_cursor!); requireReload.current = false; setLocked(false);
    } finally {
      if (current()) { running.current = false; setBusy(false); }
    }
  }, [clearContext, source, verifyClient]);

  useEffect(() => {
    live.current = true; running.current = false; void load();
    return stop;
  }, [load, stop]);

  async function mutate(row: MappingRecord, removing: boolean) {
    if (running.current || requireReload.current || !live.current || !rows.includes(row)
      || (removing ? row.client_id !== clientId || !row.mapping_id || pending !== row : row.client_id !== null)) return;
    running.current = true;
    const sequence = ++operation.current;
    const current = () => live.current && sequence === operation.current;
    setBusy(true); setPending(null); setError(null); setNotice(null);
    try {
      if (!await verifyClient(current) || !current()) return;
      // Once sent, any uncertain outcome requires an explicit read before another write.
      requireReload.current = true; setLocked(true);
      setError("Mapping confirmation is pending. Reload mappings if confirmation cannot be completed.");
      const url = `${API}/${clientId}/mappings/${source}/${row.id}`;
      const result = removing ? await apiDelete<MappingResult>(url, { mapping_id: row.mapping_id }) : await apiPost<MappingResult>(url, {});
      if (!current()) return;
      const failure = responseError(result) || (!validMappingResult(result, source, row.id, clientId, removing) ? "invalid_mapping_response" : null);
      if (failure && accessLost(failure)) { clearContext(failure); return; }
      if (!await verifyClient(current) || !current()) return;
      if (failure) {
        setError(failure === "mapping_conflict" ? "This mapping changed elsewhere. Reload mappings before trying again."
          : "Mapping change was not confirmed. The server may have received it. Reload mappings before trying again.");
        return;
      }
      setRows((previous) => previous.map((record) => record.id !== row.id ? record : { ...record,
        client_id: removing ? null : clientId, mapping_id: removing ? null : result.mapping!.mapping_id }));
      requireReload.current = false; setLocked(false); setError(null);
      setNotice(removing ? "Mapping removed." : "Mapping assigned.");
    } finally {
      if (current()) { running.current = false; setBusy(false); }
    }
  }

  return <>
    {busy && <p role="status">Loading or verifying mappings…</p>}
    {error && <p role="alert" style={{ color: "#991B1B", background: "#FEF2F2", padding: 12, overflowWrap: "anywhere" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!busy && !error && !rows.length && <p>No records are available for this source in this workspace.</p>}
    <ul style={{ padding: 0, listStyle: "none" }}>{rows.map((row) => <li key={row.id} data-record-id={row.id}
      style={{ borderTop: "1px solid #E2E8F0", padding: "12px 0", overflowWrap: "anywhere" }}>
      <strong>{row.label || "Untitled record"}</strong><div>Record #{row.id}</div>
      <div>{row.client_id === null ? "Unassigned" : row.client_id === clientId ? "Assigned to this client" : `Assigned to another client (#${row.client_id})`}</div>
      {row.client_id === null && <button style={button} disabled={busy || locked || !!pending} onClick={() => void mutate(row, false)}>Assign to client</button>}
      {row.client_id === clientId && <button style={button} disabled={busy || locked || !!pending} onClick={() => setPending(row)}>Remove mapping</button>}
      {pending === row && <div role="alert">
        <p>Remove this record from this client&apos;s reporting data? The source record will be retained.</p>
        <button style={button} disabled={busy || locked} onClick={() => void mutate(row, true)}>Confirm removal</button>
        <button style={button} disabled={busy} onClick={() => setPending(null)}>Cancel removal</button>
      </div>}
    </li>)}</ul>
    <button style={button} disabled={busy} onClick={() => void load()}>Reload mappings</button>
    {cursor && <button style={button} disabled={busy || locked || !!pending} onClick={() => void load(cursor)}>Load more records</button>}
  </>;
}
