import { BRAND_FIELDS, validClient, type Branding, type Client, type Draft } from "@/lib/clientReporting";
export type Preview = { ok: true; client: Client; profile_version: number; format: Draft["default_format"]; can_generate: boolean;
  brand: Branding; report: { title: string; generated_at: string; sections: { kind: "table"; title: string; headers: string[]; rows: (string | number | null)[][] }[] } };
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
export function validPreview(value: unknown, id: number, version: number, format: string): value is Preview {
  if (!value || typeof value !== "object") return false;
  const p = value as Preview, r = p.report;
  return p.ok === true && validClient(p.client) && p.client.id === id && p.profile_version === version && p.format === format
    && typeof p.can_generate === "boolean" && !!p.brand && typeof p.brand === "object" && !Array.isArray(p.brand)
    && Object.entries(p.brand).every(([key, value]) => BRAND_FIELDS.some(([name, , max]) => name === key && text(value, max))
      && (!key.endsWith("Color") || /^#[0-9a-fA-F]{6}$/.test(value)))
    && !!r && text(r.title, 160) && text(r.generated_at, 40) && Number.isFinite(Date.parse(r.generated_at))
    && Array.isArray(r.sections) && r.sections.length > 0 && r.sections.length <= 60 && r.sections.every((s) => s && s.kind === "table"
      && text(s.title, 200) && Array.isArray(s.headers) && s.headers.length > 0 && s.headers.length <= 20 && s.headers.every((h) => text(h, 200))
      && Array.isArray(s.rows) && s.rows.length <= 250 && s.rows.every((row) => Array.isArray(row) && row.length === s.headers.length
        && row.every((cell) => cell === null || text(cell) || typeof cell === "number" && Number.isFinite(cell))));
}
export const REPORT_MIME = { pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export async function validReportBlob(blob: Blob, format: keyof typeof REPORT_MIME): Promise<boolean> {
  if (blob.type.split(";")[0].toLowerCase() !== REPORT_MIME[format] || blob.size < 5 || blob.size > 20 * 1024 * 1024) return false;
  const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return format === "pdf" ? String.fromCharCode(...bytes) === "%PDF-" : bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
}
