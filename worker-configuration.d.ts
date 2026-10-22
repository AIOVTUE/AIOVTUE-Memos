// Generated manually for local typecheck; prefer `npm run cf-typegen` after install.
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional. Prefer this Worker Secret for AES-wrapping Resend/WebDAV passwords (not stored in D1). */
  SECRET_ENCRYPTION_KEY?: string;
}
