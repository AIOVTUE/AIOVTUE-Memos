import { clampTimestamp, sanitizeImageList } from "./utils";

export type ParsedMoment = {
  content: string;
  images: string[];
  created_at: number;
  filename?: string;
};

const IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/g;
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse Hugo moments markdown (front matter date + text + ![](url) images). */
export function parseMomentMarkdown(raw: string, filename?: string): ParsedMoment | null {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.trim()) return null;
  if (filename && /(^|\/)_index\.md$/i.test(filename)) return null;

  let body = text;
  let createdAt = Date.now();

  const fm = text.match(FRONT_MATTER_RE);
  if (fm) {
    const meta = fm[1];
    const dateMatch = meta.match(/^date:\s*(.+)$/m);
    if (dateMatch) {
      const parsed = parseFrontMatterDate(dateMatch[1].trim());
      if (parsed) createdAt = parsed;
    }
    body = text.slice(fm[0].length);
  } else if (filename) {
    const fromName = parseDateFromFilename(filename);
    if (fromName) createdAt = fromName;
  }

  const images: string[] = [];
  let content = body.replace(IMAGE_RE, (_full, url: string) => {
    const u = String(url || "").trim();
    if (u) images.push(u);
    return "";
  });

  content = content.replace(/\n{3,}/g, "\n\n").trim();
  const safeImages = sanitizeImageList(images);
  if (!content && safeImages.length === 0) return null;

  return {
    content: content.slice(0, 4000),
    images: safeImages,
    created_at: clampTimestamp(createdAt),
    filename,
  };
}

export function toMomentMarkdown(post: { content: string; images: string[]; created_at: number }): string {
  const date = formatFrontMatterDate(post.created_at);
  const lines = [`---`, `date: ${date}`, `---`];
  const text = (post.content || "").replace(/\r\n/g, "\n").trim();
  if (text) {
    // Hugo moments 原文用行尾两个空格做硬换行
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/\s+$/, "");
      lines.push(line ? `${line}  ` : "");
    }
  }
  for (const url of post.images || []) {
    if (url) lines.push(`![](${url})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Hugo content/moments/_index.md — drop-in section index. */
export function toMomentsIndexMarkdown(settings?: {
  site_title?: string;
  cover?: string;
}): string {
  const title = String(settings?.site_title || "动态").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const cover = String(settings?.cover || "/hero/hero-1.mp4").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `---`,
    `title: "${title}"`,
    `layout: "moments"`,
    `icon: "ant-design:compass-filled"`,
    `cover: "${cover}"`,
    `cascade:`,
    `  - target:`,
    `      kind: page`,
    `    build:`,
    `      render: never`,
    `      list: always`,
    `---`,
    ``,
  ].join("\n");
}

export function filenameFromDate(ts: number, used = new Set<string>()): string {
  const d = new Date(ts);
  const y = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  let base = `${y}-${m}-${day}.md`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  base = `${y}-${m}-${day}-${hh}${mm}.md`;
  let i = 1;
  let name = base;
  while (used.has(name)) {
    name = `${y}-${m}-${day}-${hh}${mm}-${i}.md`;
    i += 1;
  }
  used.add(name);
  return name;
}

function parseFrontMatterDate(value: string): number | null {
  // 2024-04-05 19:50:00 or 2024-04-05T19:50:00
  const cleaned = value.replace(/^["']|["']$/g, "").trim();
  const m = cleaned.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!m) {
    const t = Date.parse(cleaned);
    return Number.isFinite(t) ? t : null;
  }
  const [, ys, mos, ds, hs = "0", mis = "0", ss = "0"] = m;
  const dt = new Date(
    Number(ys),
    Number(mos) - 1,
    Number(ds),
    Number(hs),
    Number(mis),
    Number(ss),
  );
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

function parseDateFromFilename(filename: string): number | null {
  const base = filename.split(/[/\\]/).pop() || filename;
  // 24-4-5.md / 2026-07-18.md
  const m = base.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})(?:-(\d{2})(\d{2}))?/);
  if (!m) return null;
  let year = Number(m[1]);
  if (year < 100) year += 2000;
  const hour = m[4] ? Number(m[4]) : 12;
  const minute = m[5] ? Number(m[5]) : 0;
  const dt = new Date(year, Number(m[2]) - 1, Number(m[3]), hour, minute, 0);
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

function formatFrontMatterDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
