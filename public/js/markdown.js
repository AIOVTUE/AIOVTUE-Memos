import { escapeHtml } from "./api.js";

/** Allow http(s) and site-relative paths only (aligned with server sanitizeRelativePath). */
function safeUrl(raw) {
  const u = String(raw || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      if (parsed.username || parsed.password) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }
  if (!u.startsWith("/") || u.startsWith("//")) return "";
  let path = u.split(/[?#]/)[0] || "/";
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    } catch {
      return "";
    }
  }
  path = path.replace(/\\/g, "/");
  if (/[\0\r\n\s<>"'`]/.test(path) || /%2e/i.test(path)) return "";
  const parts = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return "";
    parts.push(seg);
  }
  return `/${parts.join("/")}`.slice(0, 500);
}

function renderInline(raw) {
  let text = String(raw ?? "");
  const slots = [];
  const park = (html) => {
    const key = `%%MD${slots.length}%%`;
    slots.push(html);
    return key;
  };

  // Inline code first (raw)
  text = text.replace(/`([^`\n]+)`/g, (_, code) =>
    park(`<code class="md-code">${escapeHtml(code)}</code>`),
  );

  // Images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(`![${alt}](${url})`);
    return park(
      `<img class="md-img" src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />`,
    );
  });

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(`[${label}](${url})`);
    const external = /^https?:\/\//i.test(href);
    const rel = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : "";
    return park(`<a class="md-link" href="${escapeHtml(href)}"${rel}>${escapeHtml(label)}</a>`);
  });

  text = escapeHtml(text);

  // Bold / italic / strike (on escaped text; markers unchanged)
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");

  text = text.replace(/%%MD(\d+)%%/g, (_, i) => slots[Number(i)] || "");
  return text;
}

function isHr(line) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
}

function listKind(line) {
  if (/^\s*[-*+]\s+/.test(line)) return "ul";
  if (/^\s*\d+\.\s+/.test(line)) return "ol";
  return "";
}

function listItemText(line) {
  return line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
}

/**
 * Basic Markdown → safe HTML.
 * Supports: headings, bold/italic/strike, inline code, fenced code,
 * links, images, quotes, lists, hr, paragraphs + soft line breaks.
 */
export function renderMarkdown(source) {
  const input = String(source ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!input.trim()) return "";

  const lines = input.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code
    const fence = trimmed.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      i += 1;
      const buf = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(
        `<pre class="md-pre"><code${langAttr}>${escapeHtml(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Heading
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level} class="md-h md-h${level}">${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (isHr(trimmed)) {
      out.push('<hr class="md-hr" />');
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote class="md-quote">${renderInline(buf.join("\n")).replace(/\n/g, "<br />")}</blockquote>`);
      continue;
    }

    // Lists
    const kind = listKind(line);
    if (kind) {
      const items = [];
      while (i < lines.length && listKind(lines[i]) === kind) {
        items.push(`<li>${renderInline(listItemText(lines[i]))}</li>`);
        i += 1;
      }
      out.push(`<${kind} class="md-list md-list--${kind}">${items.join("")}</${kind}>`);
      continue;
    }

    // Paragraph (until blank / block start)
    const para = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nt = next.trim();
      if (!nt) break;
      if (/^```/.test(nt) || /^#{1,3}\s+/.test(nt) || isHr(nt) || /^>\s?/.test(nt) || listKind(next)) {
        break;
      }
      para.push(next);
      i += 1;
    }
    const html = para.map((l) => renderInline(l)).join("<br />");
    out.push(`<p class="md-p">${html}</p>`);
  }

  return out.join("");
}
