import { BROWSER_USER_AGENT, REQUEST_TIMEOUT_MS } from "../constants.js";

export class UpstreamError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "UpstreamError";
  }
}

function isCloudflareChallenge(status: number, body: string): boolean {
  return status === 403 && /Just a moment|challenge-platform|cf-chl/i.test(body);
}

async function request(url: string, accept: "json" | "html", extraHeaders: Record<string, string> = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept-Language": "en,fr;q=0.8",
        ...(accept === "json"
          ? { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
          : { Accept: "text/html,application/xhtml+xml" }),
        ...extraHeaders,
      },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : String(err);
    throw new UpstreamError(`Request to ${url} failed (${reason}). Check your internet connection and retry.`);
  }

  const body = await res.text();
  if (res.ok) return body;

  if (isCloudflareChallenge(res.status, body)) {
    throw new UpstreamError(
      `Smoothcomp's Cloudflare protection blocked the request to ${url}. Wait a few minutes and retry; if it persists, open the event URL in a browser instead.`,
      res.status
    );
  }
  if (res.status === 404) {
    throw new UpstreamError(`Not found on Smoothcomp: ${url}. Check the event ID (use smoothcomp_search_events to find valid IDs).`, 404);
  }
  if (res.status === 403) {
    let detail = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body);
      detail = typeof parsed === "string" ? parsed : parsed?.errors?.[0]?.detail ?? detail;
    } catch {
      /* body was not JSON */
    }
    throw new UpstreamError(`Smoothcomp refused access to ${url}: ${detail}`, 403);
  }
  if (res.status === 429) {
    throw new UpstreamError("Smoothcomp rate limit reached. Wait a minute before retrying.", 429);
  }
  throw new UpstreamError(`Smoothcomp returned HTTP ${res.status} for ${url}.`, res.status);
}

export async function getJson<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
  const body = await request(url, "json", extraHeaders);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError(`Expected JSON from ${url} but got something else. Smoothcomp may have changed its site.`);
  }
}

export function getHtml(url: string): Promise<string> {
  return request(url, "html");
}

/** Small in-memory TTL cache that also de-duplicates concurrent requests. */
export class TtlCache<T> {
  private store = new Map<string, { expires: number; value: Promise<T> }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load();
    this.store.set(key, { expires: Date.now() + this.ttlMs, value });
    value.catch(() => this.store.delete(key));
    return value;
  }
}
