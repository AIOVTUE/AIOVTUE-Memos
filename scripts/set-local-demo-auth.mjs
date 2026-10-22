/** 仅本地：管理员 demo / demo。用法：node scripts/set-local-demo-auth.mjs */
import { execFileSync } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const salt = randomBytes(16);
const hash = pbkdf2Sync("demo", salt, 100_000, 32, "sha256");
const stored = `pbkdf2:v1:100000:${salt.toString("base64")}:${hash.toString("base64")}`;
const secret = randomBytes(32).toString("base64");
const sql = [
  `INSERT INTO settings (key, value) VALUES ('admin_username', 'demo') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  `INSERT INTO settings (key, value) VALUES ('admin_password_hash', '${stored}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  `INSERT INTO settings (key, value) VALUES ('admin_token_secret', '${secret}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
].join("\n");
const file = join(tmpdir(), "aiovtue-memos-demo-auth.sql");
writeFileSync(file, sql, "utf8");
try {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "aiovtue-memos", "--local", `--file=${file}`],
    { stdio: "inherit", shell: true },
  );
} finally {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
console.log("local admin: demo / demo");
