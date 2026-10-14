import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCatalog } from "../services/smoothcomp.js";
import { geocode, haversineKm } from "../services/geo.js";
import { normalize } from "../services/text.js";
import type { ListedEvent, Sport } from "../types.js";
import { READ_ONLY_ANNOTATIONS, errorResult, respond, responseFormatSchema } from "./common.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function resolveSports(filters: string[], sports: Sport[]): { ids: Set<number>; unknown: string[] } {
  const ids = new Set<number>();
  const unknown: string[] = [];
  for (const f of filters) {
    if (/^\d+$/.test(f)) {
      ids.add(Number(f));
      continue;
    }
    const nf = normalize(f);
    const matches = sports.filter(s => normalize(s.name).includes(nf) || normalize(s.group).includes(nf));
    if (matches.length) matches.forEach(s => ids.add(s.id));
    else unknown.push(f);
  }
  return { ids, unknown };
}

function eventLine(e: ListedEvent): string {
  const where = [e.city, e.country].filter(Boolean).join(", ");
  const dist = e.distance_km !== undefined ? ` · ${e.distance_km} km` : "";
  return `- **${e.title}** (ID ${e.id})\n  ${e.start_date}${e.end_date !== e.start_date ? ` → ${e.end_date}` : ""} · ${where}${dist}\n  Sports: ${e.sports.join(", ") || "n/a"}\n  ${e.url}`;
}

export function registerEventTools(server: McpServer): void {
  server.registerTool(
    "smoothcomp_search_events",
    {
      title: "Search upcoming Smoothcomp competitions",
      description: `Find upcoming competitions (BJJ, grappling, wrestling, judo, MMA, sambo...) listed on Smoothcomp, filtered by geographic area, dates, sport and name.

Geographic filters (combine freely):
  - near: a place name geocoded via OpenStreetMap (e.g. "Lyon, France"), used with radius_km
  - latitude + longitude: an explicit point, used with radius_km
  - countries: ISO 3166-1 alpha-2 codes, e.g. ["FR", "BE", "CH"]
  - city: case/accent-insensitive substring of the event's city, e.g. "paris"
Other filters: start_date / end_date (YYYY-MM-DD), sports (names like "grappling", "brazilian jiu-jitsu", or IDs from smoothcomp_list_sports), query (substring of the event title).

Results are sorted by start date (or by distance when sort="distance"). Events without coordinates are excluded from radius searches.

Returns: total matches, pagination info and for each event: id, title, url, start_date, end_date, city, country, latitude, longitude, sports, distance_km (radius searches only).
Use smoothcomp_get_event_categories and smoothcomp_get_event_requirements with an event id for details.`,
      inputSchema: {
        near: z.string().min(2).optional().describe('Place to search around, e.g. "Bordeaux", "Genève, Suisse"'),
        latitude: z.number().min(-90).max(90).optional().describe("Latitude of the search center (use with longitude)"),
        longitude: z.number().min(-180).max(180).optional().describe("Longitude of the search center (use with latitude)"),
        radius_km: z.number().positive().max(5000).default(100).describe("Search radius in km around near/latitude+longitude (default 100)"),
        countries: z.array(z.string().length(2)).optional().describe('ISO country codes, e.g. ["FR"]'),
        city: z.string().optional().describe("Substring of the city name"),
        start_date: isoDate.optional().describe("Only events starting on/after this date (YYYY-MM-DD)"),
        end_date: isoDate.optional().describe("Only events starting on/before this date (YYYY-MM-DD)"),
        sports: z.array(z.string()).optional().describe('Sport names or IDs, e.g. ["grappling", "wrestling"]. Matches any.'),
        query: z.string().optional().describe("Substring of the event title, e.g. 'open', 'AIGA'"),
        sort: z.enum(["date", "distance"]).default("date").describe("Sort order; 'distance' requires a search center"),
        limit: z.number().int().min(1).max(100).default(25).describe("Max results (1-100, default 25)"),
        offset: z.number().int().min(0).default(0).describe("Results to skip, for pagination"),
        response_format: responseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async args => {
      try {
        if ((args.latitude === undefined) !== (args.longitude === undefined)) {
          return errorResult(("Provide both latitude and longitude, or use 'near' with a place name."));
        }
        const { events, sports, fetchedAt } = await getCatalog();

        let center: { latitude: number; longitude: number; label: string } | null = null;
        if (args.latitude !== undefined && args.longitude !== undefined) {
          center = { latitude: args.latitude, longitude: args.longitude, label: `${args.latitude}, ${args.longitude}` };
        } else if (args.near) {
          center = await geocode(args.near);
        }

        let sportIds: Set<number> | null = null;
        let unknownSports: string[] = [];
        if (args.sports?.length) {
          const r = resolveSports(args.sports, sports);
          sportIds = r.ids;
          unknownSports = r.unknown;
          if (!sportIds.size) {
            return errorResult((`Unknown sport(s): ${unknownSports.join(", ")}. Call smoothcomp_list_sports to see valid names.`));
          }
        }

        const countries = args.countries?.map(c => c.toUpperCase());
        const city = args.city ? normalize(args.city) : null;
        const q = args.query ? normalize(args.query) : null;

        let matches: ListedEvent[] = [];
        for (const e of events) {
          if (countries && !countries.includes(e.country_code)) continue;
          if (city && !normalize(e.city).includes(city)) continue;
          if (args.start_date && e.start_date < args.start_date) continue;
          if (args.end_date && e.start_date > args.end_date) continue;
          if (sportIds && !e.sport_ids.some(id => sportIds!.has(id))) continue;
          if (q && !normalize(e.title).includes(q)) continue;
          if (center) {
            if (e.latitude === null || e.longitude === null) continue;
            const d = haversineKm(center.latitude, center.longitude, e.latitude, e.longitude);
            if (d > args.radius_km) continue;
            matches.push({ ...e, distance_km: Math.round(d) });
          } else {
            matches.push(e);
          }
        }

        matches.sort((a, b) =>
          args.sort === "distance" && center
            ? (a.distance_km ?? 0) - (b.distance_km ?? 0)
            : a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title)
        );

        const total = matches.length;
        const page = matches.slice(args.offset, args.offset + args.limit).map(({ sport_ids, ...rest }) => rest);
        const hasMore = args.offset + page.length < total;
        const data = {
          total,
          count: page.length,
          offset: args.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: args.offset + page.length } : {}),
          search_center: center,
          radius_km: center ? args.radius_km : null,
          ...(unknownSports.length ? { unknown_sports_ignored: unknownSports } : {}),
          data_fetched_at: fetchedAt,
          events: page,
        };

        return respond(args.response_format, data, () => {
          const lines = [`# Smoothcomp events: ${total} match${total === 1 ? "" : "es"}`];
          if (center) lines.push(`Within ${args.radius_km} km of ${center.label}`);
          if (unknownSports.length) lines.push(`(Ignored unknown sports: ${unknownSports.join(", ")})`);
          lines.push("", ...(page.length ? page.map(e => eventLine(e as ListedEvent)) : ["No events match these filters. Try a larger radius or fewer filters."]));
          if (hasMore) lines.push("", `More results available: use offset=${args.offset + page.length}.`);
          return lines.join("\n");
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "smoothcomp_list_sports",
    {
      title: "List Smoothcomp sports",
      description: `List the sports/disciplines Smoothcomp uses to tag events (e.g. Brazilian Jiu-Jitsu, Grappling, Wrestling, Judo, MMA, Sambo), with their IDs and the number of upcoming events for each.
Use the names or IDs in the 'sports' filter of smoothcomp_search_events.

Args:
  - query (string, optional): filter sports by name substring
  - response_format: 'markdown' or 'json'`,
      inputSchema: {
        query: z.string().optional().describe("Filter by name substring, e.g. 'jiu'"),
        response_format: responseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, response_format }) => {
      try {
        const { events, sports } = await getCatalog();
        const counts = new Map<number, number>();
        for (const e of events) for (const id of e.sport_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        const nq = query ? normalize(query) : null;
        const list = sports
          .filter(s => !nq || normalize(s.name).includes(nq) || normalize(s.group).includes(nq))
          .map(s => ({ ...s, upcoming_events: counts.get(s.id) ?? 0 }))
          .sort((a, b) => b.upcoming_events - a.upcoming_events);
        return respond(response_format, { count: list.length, sports: list }, () =>
          [`# Smoothcomp sports (${list.length})`, "", ...list.map(s => `- ${s.name} (ID ${s.id}, ${s.group}): ${s.upcoming_events} upcoming events`)].join("\n")
        );
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
