const ENC_PREFIX = "enc:v1:";
const PBKDF2_SALT = "hugo-memos-resend-v1";
const PBKDF2_ITERATIONS = 100_000;

/** Settings keys that hold AES-wrapped secrets in D1. */
export const ENCRYPTED_SETTING_KEYS = ["resend_api_key", "webdav_password"] as const;

async function readTokenSecretFromDb(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'admin_token_secret' LIMIT 1")
    .first<{ value: string }>();
  return String(row?.value || "").trim();
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Prefer Worker Secret `SECRET_ENCRYPTION_KEY` (not in D1).
 * Fall back to admin_token_secret so existing installs keep working.
 */
export async function getWrapSecret(env: Env): Promise<string> {
  const fromEnv = String((env as Env & { SECRET_ENCRYPTION_KEY?: string }).SECRET_ENCRYPTION_KEY || "").trim();
  if (fromEnv) return fromEnv;
  return readTokenSecretFromDb(env.DB);
}

/** True when wrap key lives outside D1 (recommended for production). */
export function hasExternalWrapKey(env: Env): boolean {
  return Boolean(String((env as Env & { SECRET_ENCRYPTION_KEY?: string }).SECRET_ENCRYPTION_KEY || "").trim());
}

async function encryptWithSecret(wrapSecret: string, plaintext: string): Promise<string> {
  const key = await deriveAesKey(wrapSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}${toBase64(iv)}.${toBase64(cipher)}`;
}

async function decryptWithSecret(wrapSecret: string, stored: string): Promise<string> {
  const raw = String(stored || "").trim();
  if (!raw) return "";
  if (!raw.startsWith(ENC_PREFIX)) {
    // Legacy plaintext: return as-is; migratePlaintextSecrets should re-save encrypted.
    return raw;
  }
  const payload = raw.slice(ENC_PREFIX.length);
  const [ivB64, cipherB64] = payload.split(".");
  if (!ivB64 || !cipherB64) return "";
  try {
    const key = await deriveAesKey(wrapSecret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivB64) },
      key,
      fromBase64(cipherB64),
    );
    return new TextDecoder().decode(plain).trim();
  } catch {
    return "";
  }
}

/** Encrypt a secret for D1 settings storage. */
export async function encryptSettingSecret(env: Env, plaintext: string): Promise<string> {
  const secret = await getWrapSecret(env);
  if (!secret) throw new Error("站点尚未初始化，无法加密保存密钥");
  return encryptWithSecret(secret, plaintext);
}

/** Decrypt a value previously stored by encryptSettingSecret. Returns "" if empty/invalid. */
export async function decryptSettingSecret(env: Env, stored: string): Promise<string> {
  const secret = await getWrapSecret(env);
  if (!secret && String(stored || "").startsWith(ENC_PREFIX)) return "";
  if (!secret) return String(stored || "").trim().startsWith(ENC_PREFIX) ? "" : String(stored || "").trim();
  return decryptWithSecret(secret, stored);
}

export function isEncryptedSettingSecret(stored: string): boolean {
  return String(stored || "").trim().startsWith(ENC_PREFIX);
}

export function hasStoredResendKey(stored: string): boolean {
  return Boolean(String(stored || "").trim());
}

async function upsertSettings(db: D1Database, pairs: Array<{ key: string; value: string }>): Promise<void> {
  if (!pairs.length) return;
  await db.batch(
    pairs.map((p) =>
      db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(p.key, p.value),
    ),
  );
}

/**
 * Re-encrypt AES blobs when the D1-backed wrap key (admin_token_secret) rotates.
 * No-op when SECRET_ENCRYPTION_KEY is set (wrap key is independent of password).
 */
export async function rewrapSecretsAfterTokenRotation(
  env: Env,
  oldTokenSecret: string,
  newTokenSecret: string,
): Promise<void> {
  if (hasExternalWrapKey(env)) return;
  if (!oldTokenSecret || !newTokenSecret || oldTokenSecret === newTokenSecret) return;

  const keys = [...ENCRYPTED_SETTING_KEYS];
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`,
  )
    .bind(...keys)
    .all<{ key: string; value: string }>();

  const updates: Array<{ key: string; value: string }> = [];
  for (const row of results || []) {
    const stored = String(row.value || "").trim();
    if (!stored || !stored.startsWith(ENC_PREFIX)) continue;
    const plain = await decryptWithSecret(oldTokenSecret, stored);
    if (!plain) continue;
    updates.push({ key: row.key, value: await encryptWithSecret(newTokenSecret, plain) });
  }
  await upsertSettings(env.DB, updates);
}

/** Upgrade legacy plaintext Resend / WebDAV passwords to enc:v1. */
export async function migratePlaintextSecrets(env: Env): Promise<void> {
  const wrap = await getWrapSecret(env);
  if (!wrap) return;

  const keys = [...ENCRYPTED_SETTING_KEYS];
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`,
  )
    .bind(...keys)
    .all<{ key: string; value: string }>();

  const updates: Array<{ key: string; value: string }> = [];
  for (const row of results || []) {
    const stored = String(row.value || "").trim();
    if (!stored || stored.startsWith(ENC_PREFIX)) continue;
    updates.push({ key: row.key, value: await encryptWithSecret(wrap, stored) });
  }
  await upsertSettings(env.DB, updates);
}
