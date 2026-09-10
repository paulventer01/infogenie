import type { ApiResult } from "@/lib/api";
import { positiveId } from "@/lib/clientReporting";

export type MappingSource = "search-intel" | "campaigns";
export type MappingRecord = { id: number; label: string; client_id: number | null; mapping_id: string | null };
export type MappingPage = ApiResult & { source?: MappingSource; records?: MappingRecord[]; has_more?: boolean; next_cursor?: number | null };
export type MappingResult = ApiResult & { source?: MappingSource; deleted?: boolean;
  mapping?: { record_id: number; client_id: number; mapping_id: string } };
export const mappingToken = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validMappingPage(result: MappingPage, source: MappingSource, cursor: number | null): boolean {
  return result.source === source && Array.isArray(result.records) && result.records.length <= 50
    && result.records.every((row, index, rows) => row && positiveId(row.id) && typeof row.label === "string"
      && row.id > (index ? rows[index - 1].id : cursor || 0)
      && (row.client_id === null && row.mapping_id === null || positiveId(row.client_id) && mappingToken(row.mapping_id)))
    && typeof result.has_more === "boolean" && (result.has_more
      ? result.records.length === 50 && result.next_cursor === result.records.at(-1)?.id : result.next_cursor === null);
}
export function validMappingResult(result: MappingResult, source: MappingSource, recordId: number, clientId: number, removing: boolean): boolean {
  return result.source === source && (removing ? result.deleted === true
    : result.mapping?.record_id === recordId && result.mapping.client_id === clientId && mappingToken(result.mapping.mapping_id));
}
