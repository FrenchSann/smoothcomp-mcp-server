import type { EditorBlock } from "../types.js";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", euro: "€", rsquo: "’", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[⁠​]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function listItemsToLines(items: unknown, depth = 0): string[] {
  if (!Array.isArray(items)) return [];
  const lines: string[] = [];
  for (const item of items) {
    const prefix = `${"  ".repeat(depth)}- `;
    if (typeof item === "string") lines.push(prefix + htmlToText(item));
    else if (item && typeof item === "object") {
      const o = item as { content?: string; text?: string; items?: unknown };
      lines.push(prefix + htmlToText(o.content ?? o.text ?? ""));
      lines.push(...listItemsToLines(o.items, depth + 1));
    }
  }
  return lines;
}

/** Converts Editor.js blocks (Smoothcomp's CMS format) to plain text. */
export function editorBlocksToText(blocks: EditorBlock[] | undefined): string {
  if (!blocks) return "";
  const out: string[] = [];
  for (const b of blocks) {
    const d = b.data ?? {};
    switch (b.type) {
      case "header":
        out.push(`## ${htmlToText(String(d.text ?? ""))}`);
        break;
      case "list":
      case "nestedlist":
      case "checklist":
        out.push(listItemsToLines(d.items).join("\n"));
        break;
      case "table":
        if (Array.isArray(d.content)) {
          out.push((d.content as unknown[][]).map(row => row.map(c => htmlToText(String(c ?? ""))).join(" | ")).join("\n"));
        }
        break;
      case "quote":
        out.push(`> ${htmlToText(String(d.text ?? ""))}`);
        break;
      case "raw":
        out.push(htmlToText(String(d.html ?? "")));
        break;
      case "delimiter":
        out.push("---");
        break;
      default:
        if (typeof d.text === "string") out.push(htmlToText(d.text));
        else if (typeof d.caption === "string") out.push(htmlToText(d.caption));
    }
  }
  return out.filter(s => s.trim()).join("\n");
}

/** Extracts a JSON array/object literal that starts at the first `open` char after `marker`. */
export function extractJsonLiteral(source: string, marker: string): string | null {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const start = source.indexOf(marker.trim().slice(-1), at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Case- and accent-insensitive normalisation for matching. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more characters]`;
}
