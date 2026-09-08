export type NullableNumber = number | null;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function todayIso(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function monthStartIso(date = new Date()): string {
  const today = todayIso(date);
  return today.slice(0, 8) + "01";
}

export function buildAgencyOpsQuery(from: string, to: string): string {
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export function formatHours(value: unknown): string {
  const number = finiteNumber(value);
  return number === null ? "Unavailable" : `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}h`;
}

export function formatPercent(value: unknown): string {
  const number = finiteNumber(value);
  return number === null ? "Unavailable" : `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function formatMoney(value: unknown, currency: unknown): string {
  const number = finiteNumber(value);
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (number === null || !/^[A-Z]{3,10}$/.test(code)) return "Unavailable";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(number);
  } catch {
    return "Unavailable";
  }
}

export function pricingCompleteness(hours: unknown, unpricedHours: unknown): number | null {
  const total = finiteNumber(hours);
  const unpriced = finiteNumber(unpricedHours);
  if (total === null || unpriced === null || total <= 0) return null;
  return Math.max(0, Math.min(100, ((total - Math.max(0, unpriced)) / total) * 100));
}

export function scopeStatusLabel(status: unknown): string {
  if (status === "over_scope") return "Over scope";
  if (status === "change_budget_used") return "Change budget used";
  if (status === "within_scope") return "Within scope";
  return "Unavailable";
}


export function isDataUnavailable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.data_unavailable === true
    || record.source === "data_unavailable"
    || record._dataMode === "strict"
    || record._data_mode === "strict";
}

export function dataUnavailableMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "This data is currently unavailable. The issue has been reported to your administrator.";
}
