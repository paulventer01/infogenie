export type MetricCatalogEntry = { key: string; label: string };
export const METRIC_CATALOG: Record<"search-intel" | "campaigns", MetricCatalogEntry[]> = {
  "search-intel": [
    { key: "runs", label: "Runs" },
    { key: "successful_runs", label: "Successful runs" },
    { key: "brand_mentions", label: "Brand mentions" },
    { key: "mapped_queries", label: "Mapped queries" },
    { key: "recent_search_runs", label: "Recent search runs" },
  ],
  campaigns: [
    { key: "performance_rows", label: "Performance rows" },
    { key: "spend", label: "Spend" },
    { key: "impressions", label: "Impressions" },
    { key: "clicks", label: "Clicks" },
    { key: "conversions", label: "Conversions" },
    { key: "revenue", label: "Revenue" },
    { key: "mapped_campaigns", label: "Mapped campaigns" },
    { key: "recent_performance", label: "Recent performance" },
    { key: "recent_actions", label: "Recent actions" },
  ],
};
export const REPORTING_PERIODS = [
  { value: "last_7_days", label: "Last 7 completed days" },
  { value: "last_30_days", label: "Last 30 completed days" },
  { value: "previous_calendar_month", label: "Previous calendar month" },
] as const;
export type ReportingPeriod = typeof REPORTING_PERIODS[number]["value"] | "all_time";
export function defaultMetrics(source: DraftSource): string[] {
  return METRIC_CATALOG[source].map((entry) => entry.key);
}
export type DraftSource = keyof typeof METRIC_CATALOG;
