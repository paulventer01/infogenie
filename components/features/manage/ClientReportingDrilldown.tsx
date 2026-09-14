"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  drilldownContextFromPreview, drilldownTargetKey, fetchAdminDrilldown, fetchPortalDrilldown, formatDrilldownCell,
  validDrilldown, type DrilldownColumn, type DrilldownRecord, type DrilldownResponse, type DrilldownRowMeta,
  type DrilldownTarget,
} from "@/lib/clientReportingDrilldown";
import type { Preview } from "@/lib/clientReportingReport";
import { responseError } from "@/lib/clientReporting";

type Props = {
  mode: "admin" | "portal";
  clientId?: number;
  target: DrilldownTarget | null;
  onClose: () => void;
};

function clearDrilldownState(setters: {
  setRecords: (value: DrilldownRecord[]) => void;
  setColumns: (value: DrilldownColumn[]) => void;
  setTotalCount: (value: number | null) => void;
  setMetricLabel: (value: string) => void;
  setPeriodText: (value: string) => void;
  setTimezone: (value: string) => void;
  setCurrency: (value: string | null) => void;
  setLiveNotice: (value: string) => void;
  setNextCursor: (value: number | null) => void;
  setHasMore: (value: boolean) => void;
  setError: (value: string | null) => void;
}) {
  setters.setRecords([]);
  setters.setColumns([]);
  setters.setTotalCount(null);
  setters.setMetricLabel("");
  setters.setPeriodText("");
  setters.setTimezone("");
  setters.setCurrency(null);
  setters.setLiveNotice("");
  setters.setNextCursor(null);
  setters.setHasMore(false);
  setters.setError(null);
}

function drilldownErrorMessage(failure: string | null): string {
  if (failure === "metric_not_drillable") return "This metric does not support contributing-record drilldown.";
  if (failure === "invalid_currency") return "Select a currency group before viewing contributing records.";
  if (failure === "report_context_stale") return "The saved profile or reporting period changed. Refresh the report preview, then open drilldown again.";
  if (failure === "portal_auth_required" || failure === "portal_session_expired" || failure === "portal_revoked") {
    return "Portal access ended. Sign in again to view contributing records.";
  }
  return failure || "Contributing records could not be loaded.";
}

export default function ClientReportingDrilldown({ mode, clientId, target, onClose }: Props) {
  const [records, setRecords] = useState<DrilldownRecord[]>([]);
  const [columns, setColumns] = useState<DrilldownColumn[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [metricLabel, setMetricLabel] = useState("");
  const [periodText, setPeriodText] = useState("");
  const [timezone, setTimezone] = useState("");
  const [currency, setCurrency] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const sequence = useRef(0);
  const stateSetters = {
    setRecords, setColumns, setTotalCount, setMetricLabel, setPeriodText, setTimezone,
    setCurrency, setLiveNotice, setNextCursor, setHasMore, setError,
  };

  const applyResult = useCallback((result: DrilldownResponse, append: boolean) => {
    const period = result.period!;
    const dates = period.start_date && period.end_date
      ? `${period.start_date} to ${period.end_date}`
      : "All mapped activity";
    setMetricLabel(result.metric_label!);
    setPeriodText(`${period.label} (${dates})`);
    setTimezone(period.timezone);
    setCurrency(result.currency ?? null);
    setLiveNotice(result.live_notice || "");
    setTotalCount(result.total_count!);
    setColumns(result.columns!);
    setRecords(append ? (prev) => [...prev, ...result.records!] : result.records!);
    setHasMore(!!result.has_more);
    setNextCursor(result.next_cursor ?? null);
  }, []);

  const loadPage = useCallback(async (pageCursor: number, append: boolean, operation: number) => {
    if (!target) return;
    const current = () => live.current && operation === sequence.current;
    setBusy(true);
    if (!append) setError(null);
    try {
      const result = mode === "admin"
        ? await fetchAdminDrilldown(clientId!, target, pageCursor)
        : await fetchPortalDrilldown(target, pageCursor);
      if (!current()) return;
      const failure = responseError(result);
      if (failure || !validDrilldown(result)) {
        clearDrilldownState(stateSetters);
        setError(drilldownErrorMessage(failure));
        return;
      }
      applyResult(result, append);
    } catch (e) {
      if (current()) {
        clearDrilldownState(stateSetters);
        setError(e instanceof Error ? e.message : "Contributing records could not be loaded.");
      }
    } finally {
      if (current()) setBusy(false);
    }
  }, [applyResult, clientId, mode, target]);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    if (!target) {
      clearDrilldownState(stateSetters);
      return undefined;
    }
    clearDrilldownState(stateSetters);
    const operation = ++sequence.current;
    void loadPage(0, false, operation);
    return () => { ++sequence.current; };
  }, [target ? drilldownTargetKey(target) : null, loadPage]);

  if (!target) return null;

  return <section aria-label="Contributing records drilldown" role="dialog" style={{ marginTop: 16, padding: 16, border: "1px solid #CBD5E1", borderRadius: 8, background: "#F8FAFC" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <h4 style={{ margin: 0 }}>Contributing records: {metricLabel || target.metricKey}</h4>
        {periodText && <p style={{ margin: "8px 0 0", color: "#64748B", fontSize: 14 }}>Period: {periodText}. Timezone: {timezone || "UTC"}.</p>}
        {currency && <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 14 }}>Currency: {currency}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close contributing records">Close</button>
    </div>
    {liveNotice && <p style={{ fontSize: 14, color: "#92400E", marginTop: 12 }}>{liveNotice}</p>}
    {totalCount !== null && <p style={{ marginTop: 12 }}>
      <strong>{totalCount}</strong> contributing record{totalCount === 1 ? "" : "s"} total.
      {records.length > 0 && totalCount !== records.length && ` Showing ${records.length} loaded so far (not a report total).`}
    </p>}
    {busy && !records.length && <p role="status">Loading contributing records…</p>}
    {error && <p role="alert" style={{ color: "#991B1B" }}>{error}</p>}
    {!busy && !error && totalCount === 0 && <p>No contributing records matched this metric, period and mapping scope.</p>}
    {records.length > 0 && <div style={{ overflowX: "auto", marginTop: 12 }} tabIndex={0} role="region" aria-label="Contributing records table">
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col" style={{ textAlign: "left", padding: 8 }}>{column.label}</th>)}</tr></thead>
        <tbody>{records.map((record, index) => <tr key={`${record.id ?? index}`}>
          {columns.map((column) => <td key={column.key} style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{formatDrilldownCell(record[column.key])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    {hasMore && nextCursor !== null && <div style={{ marginTop: 12 }}>
      <button type="button" disabled={busy} onClick={() => {
        const operation = ++sequence.current;
        void loadPage(nextCursor, true, operation);
      }}>Load more records</button>
      {busy && <span role="status" style={{ marginLeft: 8 }}>Loading…</span>}
    </div>}
  </section>;
}

export function DrilldownControl({ meta, rowIndex, preview, onOpen }: {
  meta: DrilldownRowMeta | null | undefined;
  rowIndex: number;
  preview: Preview;
  onOpen: (target: DrilldownTarget) => void;
}) {
  if (!meta?.drillable) return null;
  const context = drilldownContextFromPreview(preview);
  return <button type="button" aria-label={`View contributing records for row ${rowIndex + 1}`}
    onClick={() => onOpen({
      metricKey: meta.metric_key,
      currency: meta.currency,
      ...context,
    })} style={{ marginTop: 4, fontSize: 13 }}>
    View contributing records
  </button>;
}
