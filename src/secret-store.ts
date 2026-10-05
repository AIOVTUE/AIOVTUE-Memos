import { getTokenSecret } from "./auth";

const ENC_PREFIX = "enc:v1:";
const PBKDF2_SALT = "hugo-memos-resend-v1";
const PBKDF2_ITERATIONS = 100_000;

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

/** Encrypt a secret for D1 settings storage. Uses admin_token_secret in settings. */
export async function encryptSettingSecret(env: Env, plaintext: string): Promise<string> {
  const secret = await getTokenSecret(env);
  if (!secret) throw new Error("站点尚未初始化，无法加密保存 API Key");
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}${toBase64(iv)}.${toBase64(cipher)}`;
}

/** Decrypt a value previously stored by encryptSettingSecret. Returns "" if empty/invalid. */
export async function decryptSettingSecret(env: Env, stored: string): Promise<string> {
  const raw = String(stored || "").trim();
  if (!raw) return "";
  if (!raw.startsWith(ENC_PREFIX)) {
    // Legacy/plaintext migration path: treat as raw key once, callers should re-save encrypted.
    return raw;
  }
  const secret = await getTokenSecret(env);
  if (!secret) return "";
  const payload = raw.slice(ENC_PREFIX.length);
  const [ivB64, cipherB64] = payload.split(".");
  if (!ivB64 || !cipherB64) return "";
  try {
    const key = await deriveAesKey(secret);
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

export function isEncryptedSettingSecret(stored: string): boolean {
  return String(stored || "").trim().startsWith(ENC_PREFIX);
}

export function hasStoredResendKey(stored: string): boolean {
  return Boolean(String(stored || "").trim());
}
