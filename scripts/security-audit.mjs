/** 仅打本地/自建实例。勿对别人的生产域名跑。默认 API_BASE=http://127.0.0.1:8787 */
const base = process.env.API_BASE || "http://127.0.0.1:8787";
const client = "audit-" + Date.now();

async function call(method, path, { body, token, clientId = client } = {}) {
  const headers = { "X-Client-Id": clientId };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

let failed = 0;
function assert(name, cond, detail = "") {
  if (!cond) {
    failed += 1;
    console.log("FAIL", name, detail);
  } else console.log("PASS", name);
}

const login = await call("POST", "/api/auth/login", { body: { password: "demo" } });
assert("login", login.status === 200 && !!login.j.token);
const token = login.j.token;

assert("bad login", (await call("POST", "/api/auth/login", { body: { password: "x" } })).status === 401);
assert("verify", (await call("GET", "/api/auth/verify", { token })).status === 200);
assert("unauth post", (await call("POST", "/api/posts", { body: { content: "x" } })).status === 401);

const page1 = await call("GET", "/api/posts?limit=10&offset=0");
assert("posts page", page1.status === 200 && Array.isArray(page1.j.data) && page1.j.meta);

const create = await call("POST", "/api/posts", {
  token,
  body: {
    content: "audit " + Date.now(),
    images: ["javascript:alert(1)", "https://example.com/a.jpg"],
  },
});
assert(
  "sanitize images",
  create.status === 201 && create.j.data.images.length === 1,
  JSON.stringify(create.j.data?.images),
);
const id = create.j.data.id;

await call("POST", `/api/posts/${id}/likes`, { body: { author_name: "A" } });
const c = await call("POST", `/api/posts/${id}/comments`, {
  body: { author_name: "B", author_email: "b@x.com", author_url: "javascript:x", content: "c" },
});
assert("no email in comment resp", !("author_email" in (c.j.data || {})));
assert("no js author_url", !(c.j.data?.author_url || "").startsWith("javascript"));

const one = await call("GET", `/api/posts/${id}`);
assert(
  "no client_id in likers",
  (one.j.data?.likers || []).every((l) => !("client_id" in l)),
);
assert(
  "no email in embedded comments",
  (one.j.data?.comments || []).every((x) => !("author_email" in x)),
);

assert(
  "reject bad avatar",
  (await call("PUT", "/api/settings", { token, body: { avatar: 'x" onerror=alert(1)' } })).status >= 400,
);
assert(
  "replace needs confirm",
  (
    await call("POST", "/api/posts/import", {
      token,
      body: { mode: "replace", posts: [{ content: "z", created_at: Date.now() }] },
    })
  ).status >= 400,
);

const exp = await call("GET", "/api/posts/export", { token });
assert("export hugo md", exp.status === 200 && exp.j.format === "hugo-markdown" && Array.isArray(exp.j.files));

await call("DELETE", `/api/posts/${id}`, { token });

console.log(failed ? `FAILED ${failed}` : "ALL OK");
process.exit(failed ? 1 : 0);
