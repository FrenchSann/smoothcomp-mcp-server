import {
  DIVISION_PAGE_CONCURRENCY,
  EVENT_DETAIL_TTL_MS,
  EVENT_LIST_TTL_MS,
  SMOOTHCOMP_BASE_URL,
  UPCOMING_EVENTS_PATH,
} from "../constants.js";
import type {
  Division,
  EventDetails,
  EventEntry,
  ListedEvent,
  RawCmsData,
  RawDivision,
  RawDivisionPage,
  RawInfoPanels,
  RawListedEvent,
  RawRegistration,
  Sport,
} from "../types.js";
import { TtlCache, UpstreamError, getHtml, getJson } from "./http.js";
import { decodeEntities, editorBlocksToText, extractJsonLiteral, htmlToText } from "./text.js";

interface Catalog {
  events: ListedEvent[];
  sports: Sport[];
  fetchedAt: string;
}

const catalogCache = new TtlCache<Catalog>(EVENT_LIST_TTL_MS);
const detailCache = new TtlCache<EventDetails>(EVENT_DETAIL_TTL_MS);
const divisionCache = new TtlCache<{ divisions: Division[]; total: number; pagesFetched: number; lastPage: number }>(
  EVENT_DETAIL_TTL_MS
);

function toCoord(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function parseSports(html: string): Sport[] {
  const m = html.match(/:category-groups="([^"]*)"/);
  if (!m) return [];
  try {
    const grouped = JSON.parse(decodeEntities(m[1])) as Record<string, Array<{ id: number; name: string; subname: string | null; group: string }>>;
    return Object.values(grouped)
      .flat()
      .map(s => ({ id: s.id, name: s.subname ? `${s.name} - ${s.subname}` : s.name, group: s.group || "Other" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Loads every upcoming event (Smoothcomp embeds the full list in the calendar page). */
export function getCatalog(): Promise<Catalog> {
  return catalogCache.get("catalog", async () => {
    const html = await getHtml(SMOOTHCOMP_BASE_URL + UPCOMING_EVENTS_PATH);
    const literal = extractJsonLiteral(html, "var events = [");
    if (!literal) {
      throw new UpstreamError("Could not find the event list in Smoothcomp's calendar page. The site layout may have changed.");
    }
    const raw = JSON.parse(literal) as RawListedEvent[];
    const sports = parseSports(html);
    const sportName = new Map(sports.map(s => [String(s.id), s.name]));
    const events: ListedEvent[] = raw
      .filter(e => !e.eventEnded)
      .map(e => ({
        id: e.id,
        title: e.title.trim(),
        url: e.url,
        start_date: e.startdate,
        end_date: e.enddate,
        period: e.eventPeriod,
        days_to_start: e.days_to_start,
        country_code: e.location_country,
        country: e.location_country_human,
        city: (e.location_city ?? "").trim(),
        latitude: toCoord(e.location_lat),
        longitude: toCoord(e.location_long),
        sport_ids: e.categoryGroups.map(Number),
        sports: [...new Set(e.categoryGroups.map(id => sportName.get(id) ?? `Sport #${id}`))],
      }));
    return { events, sports, fetchedAt: new Date().toISOString() };
  });
}

/** Base URL of an event, on the organizer/federation subdomain when known. */
async function eventBaseUrl(eventId: number): Promise<string> {
  try {
    const { events } = await getCatalog();
    const hit = events.find(e => e.id === eventId);
    if (hit) return hit.url.replace(/\/$/, "");
  } catch {
    /* fall back to the generic URL, which redirects to the right subdomain */
  }
  return `${SMOOTHCOMP_BASE_URL}/en/event/${eventId}`;
}

/** "10/18/2026 23:59" -> "2026-10-18 23:59" */
function usDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}${m[4]}` : s;
}

function unixToDate(ts: number | undefined, timeZone: string | undefined): string | null {
  if (!ts) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(ts * 1000)
    );
  } catch {
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }
}

const joinDateTime = (d?: { date: string; time: string }) => (d ? `${d.date} ${d.time}`.trim() : null);

export function getEventDetails(eventId: number): Promise<EventDetails> {
  return detailCache.get(String(eventId), async () => {
    const base = await eventBaseUrl(eventId);
    const [info, cms] = await Promise.all([
      getJson<RawInfoPanels>(`${base}/getInfoPanelsData`),
      getJson<RawCmsData>(`${base}/getCmsData`).catch(() => ({}) as RawCmsData),
    ]);

    const entries: EventEntry[] = Object.entries(info.visibleEntries ?? {}).map(([id, e]) => ({
      id,
      title: htmlToText(e.title),
      price: typeof e.price === "number" ? e.price : null,
      currency: e.currency ?? null,
      description: htmlToText(e.description ?? ""),
    }));

    const refund_policy = (info.refundData ?? []).map(
      r => `${r.refund_percentage ?? "?"}% refund (${r.refund_type ?? "unknown method"}) if cancelled before ${usDateToIso(r.refund_until) ?? "?"}`
    );
    if (!refund_policy.length) refund_policy.push("No refund configured for this event.");

    const textParts = [
      cms.infoPage?.intro_text ? htmlToText(cms.infoPage.intro_text) : "",
      cms.eventData?.description ? htmlToText(cms.eventData.description) : "",
      editorBlocksToText(cms.infoPageBlocks),
      cms.infoPage?.custom_html ? htmlToText(cms.infoPage.custom_html) : "",
    ].filter(Boolean);

    const tz = info.timezone;
    const loc = info.location ?? {};
    const org = info.organizer;
    return {
      id: eventId,
      url: base,
      title: (cms.eventData?.title ?? info.eventMap?.title ?? "").trim(),
      start_date: unixToDate(info.eventMap?.start_date, tz),
      end_date: unixToDate(info.eventMap?.end_date, tz),
      timezone: tz ?? null,
      venue: loc.location_venue ?? null,
      address: loc.location_address ?? null,
      city: loc.location_city?.trim() ?? null,
      country: loc.location_country_human ?? null,
      latitude: toCoord(info.eventMap?.lat),
      longitude: toCoord(info.eventMap?.lng),
      organizer: org
        ? {
            name: org.name,
            city: org.city ?? null,
            country: org.country ?? null,
            previous_events: info.previousEvents ?? null,
            on_smoothcomp_since: info.organizerSince ?? null,
          }
        : null,
      registration: {
        opens: joinDateTime(cms.eventData?.registration_start),
        closes: joinDateTime(cms.eventData?.registration_end),
        late_entry_until: cms.eventData?.late_entry ? joinDateTime(cms.eventData?.late_entry_end) : null,
        early_bird: Boolean(cms.eventData?.early_bird),
        edit_until: usDateToIso(info.eventDates?.edit_registration_end),
        cancel_until: usDateToIso(info.eventDates?.cancel_end_date),
      },
      refund_policy,
      entries,
      info_text: textParts.join("\n\n"),
    };
  });
}

function asList(regs: RawDivision["registrations"]): RawRegistration[] {
  if (!regs) return [];
  return Array.isArray(regs) ? regs : Object.values(regs);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Divisions (bracket groups such as "Adult / Blue / -76 kg") that already exist for an event.
 * Smoothcomp only creates a division once someone registers in it, so this reflects demand, not every option.
 */
export function getEventDivisions(eventId: number, maxPages: number) {
  return divisionCache.get(`${eventId}:${maxPages}`, async () => {
    const base = await eventBaseUrl(eventId);
    const first = await getJson<RawDivisionPage>(`${base}/participants-new?page=1`);
    const lastPage = Math.min(first.last_page ?? 1, maxPages);
    const rest = await mapWithConcurrency(
      Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => i + 2),
      DIVISION_PAGE_CONCURRENCY,
      page => getJson<RawDivisionPage>(`${base}/participants-new?page=${page}`)
    );
    const raw = [first, ...rest].flatMap(p => p.data ?? []);

    // Dimension labels ("Belt", "Age", "Weight") are only present on registrations; learn them by category_id.
    const labelById = new Map<number, string>();
    for (const d of raw) {
      for (const r of [...asList(d.registrations), ...asList(d.incompleteRegistrations)]) {
        for (const c of r.categories ?? []) if (c.category_name) labelById.set(c.category_id, c.category_name);
      }
    }

    const divisions: Division[] = raw.map(d => ({
      name: d.name,
      entry: d.entry?.name ?? null,
      values: Object.fromEntries(
        (d.categories ?? []).map((c, i) => [labelById.get(c.category_id) ?? `Category ${i + 1}`, c.name])
      ),
      registered: asList(d.registrations).length,
      pending: asList(d.incompleteRegistrations).length,
    }));

    return { divisions, total: first.total ?? divisions.length, pagesFetched: lastPage, lastPage: first.last_page ?? 1 };
  });
}
