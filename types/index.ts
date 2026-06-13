// Shared TypeScript types for the Next.js layer. Expanded in later phases as
// the dashboard surfaces are migrated.

/** A social-login provider as returned by `GET /api/auth/providers`. */
export interface AuthProvider {
  id: "google" | "facebook" | "microsoft" | string;
  label?: string;
  enabled?: boolean;
}

/** Shape of `GET /api/auth/providers`. */
export interface AuthProvidersResponse {
  providers?: AuthProvider[];
  google?: boolean;
  facebook?: boolean;
  microsoft?: boolean;
}

/** Generic JSON envelope used by the auth endpoints. */
export interface ApiResult<T = unknown> {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: T;
}
