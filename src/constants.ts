export const SMOOTHCOMP_BASE_URL = "https://smoothcomp.com";
export const UPCOMING_EVENTS_PATH = "/en/events/upcoming";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Browser-like UA: Smoothcomp sits behind Cloudflare and rejects obvious bots. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const GEOCODER_USER_AGENT = "smoothcomp-mcp-server/1.0 (personal use)";

export const REQUEST_TIMEOUT_MS = 20_000;
export const EVENT_LIST_TTL_MS = 30 * 60 * 1000;
export const EVENT_DETAIL_TTL_MS = 10 * 60 * 1000;

/** Max characters per tool response, to protect the client's context window. */
export const CHARACTER_LIMIT = 25_000;

/** participants-new returns 5 divisions per page. */
export const DIVISION_PAGE_CONCURRENCY = 4;
