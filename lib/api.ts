// Typed fetch wrapper for the React feature panels (Next.js migration Phase 3).
//
// Every InfoGenie API endpoint is same-origin (Next proxies `/api/*` to Express
// in dev, and Express serves both in prod) and returns JSON shaped as
// `{ ok: true, … }` on success or `{ ok: false, error }` on failure — HTTP 200
// even for handled errors. This wrapper preserves that contract: callers inspect
// `result.ok`. Network/transport failures and non-JSON (HTML error) responses
// are normalised into `{ ok: false, error }` too, so a ported panel never has to
// distinguish transport errors from app errors.

export interface ApiResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

/**
 * Perform a JSON API request. Always sends the session cookie (`same-origin`)
 * and a JSON `Content-Type`. Returns the parsed body; on a non-2xx status,
 * non-JSON body, or thrown transport error it returns `{ ok: false, error }`.
 */
export async function apiFetch<T extends object = ApiResult>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  try {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...opts,
      headers: { ...JSON_HEADERS, ...(opts.headers || {}) },
    });
    const ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") !== -1) {
      const body = (await res.json().catch(() => ({}))) as ApiResult;
      if (res.ok) return body as T;
      return {
        ...body,
        ok: false,
        error: body.error || `Request failed (${res.status})`,
      } as T;
    }
    if (res.ok) return {} as T;
    return { ok: false, error: `Request failed (${res.status})` } as T;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network_error",
    } as T;
  }
}

const withBody = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

export const apiGet = <T extends object = ApiResult>(path: string) =>
  apiFetch<T>(path);

export const apiPost = <T extends object = ApiResult>(
  path: string,
  body?: unknown,
) => apiFetch<T>(path, withBody("POST", body));

export const apiPut = <T extends object = ApiResult>(
  path: string,
  body?: unknown,
) => apiFetch<T>(path, withBody("PUT", body));

export const apiPatch = <T extends object = ApiResult>(
  path: string,
  body?: unknown,
) => apiFetch<T>(path, withBody("PATCH", body));

export const apiDelete = <T extends object = ApiResult>(
  path: string,
  body?: unknown,
) => apiFetch<T>(path, withBody("DELETE", body));

/**
 * Perform a request expecting a binary (Blob) response — used by export
 * endpoints (PPTX/PDF/CSV downloads). Throws on a non-2xx status so callers can
 * surface a failure toast.
 */
export async function apiBlob(
  path: string,
  opts: RequestInit = {},
): Promise<Blob> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...opts,
    headers: { ...JSON_HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.blob();
}
