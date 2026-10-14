import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEventDetails, getEventDivisions } from "../services/smoothcomp.js";
import { REQUIREMENT_LABELS, extractRequirements } from "../services/requirements.js";
import { truncate } from "../services/text.js";
import type { EventDetails, EventEntry } from "../types.js";
import { READ_ONLY_ANNOTATIONS, errorResult, eventIdSchema, respond, responseFormatSchema } from "./common.js";

const INFO_TEXT_PREVIEW = 3000;

const entryLine = (e: EventEntry) =>
  `- **${e.title}**${e.price !== null ? ` · ${e.price} ${e.currency ?? ""}`.trimEnd() : ""}${e.description ? ` · ${e.description}` : ""}`;

function registrationLines(r: EventDetails["registration"]): string[] {
  return [
    `- Opens: ${r.opens ?? "n/a"}`,
    `- Closes: ${r.closes ?? "n/a"}`,
    ...(r.late_entry_until ? [`- Late entry until: ${r.late_entry_until}`] : []),
    ...(r.early_bird ? ["- Early-bird pricing available"] : []),
    ...(r.edit_until ? [`- Edit registration until: ${r.edit_until}`] : []),
    ...(r.cancel_until ? [`- Cancel until: ${r.cancel_until}`] : []),
  ];
}

export function registerEventDetailTools(server: McpServer): void {
  server.registerTool(
    "smoothcomp_get_event",
    {
      title: "Get Smoothcomp event details",
      description: `Get the full details of one Smoothcomp competition: dates, venue, organizer, registration window (open/close/late entry/edit/cancel deadlines), refund policy, registration options with prices, and the organizer's information text (rules, schedule, weigh-in, requirements...).

Args:
  - event_id (number): Smoothcomp event ID
  - full_text (boolean): return the full information text instead of a ${INFO_TEXT_PREVIEW}-character preview (default false)
  - response_format: 'markdown' or 'json'`,
      inputSchema: {
        event_id: eventIdSchema,
        full_text: z.boolean().default(false).describe("Return the complete organizer information text"),
        response_format: responseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ event_id, full_text, response_format }) => {
      try {
        const ev = await getEventDetails(event_id);
        const data = { ...ev, info_text: full_text ? ev.info_text : truncate(ev.info_text, INFO_TEXT_PREVIEW) };
        return respond(response_format, data, () =>
          [
            `# ${ev.title} (ID ${ev.id})`,
            `${ev.start_date ?? "?"}${ev.end_date && ev.end_date !== ev.start_date ? ` → ${ev.end_date}` : ""} · ${[ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(", ")}`,
            ev.url,
            ev.organizer ? `Organizer: ${ev.organizer.name} (${ev.organizer.previous_events ?? 0} previous events on Smoothcomp)` : "",
            "",
            "## Registration",
            ...registrationLines(ev.registration),
            "",
            "## Refund policy",
            ...ev.refund_policy.map(r => `- ${r}`),
            "",
            `## Registration options (${ev.entries.length})`,
            ...(ev.entries.length ? ev.entries.map(entryLine) : ["- None published"]),
            "",
            "## Information",
            data.info_text || "_No information text published._",
          ].join("\n")
        );
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "smoothcomp_get_event_categories",
    {
      title: "Get categories of a Smoothcomp event",
      description: `List the categories available at a Smoothcomp competition, at two levels:
  1. entries: the registration options (e.g. "SENIOR", "MASCULIN GI LICENCIÉ", "U15 GI") with price, currency and age description. Always complete.
  2. divisions (optional): the brackets already created, e.g. "Adult / Blue / -76 kg", with belt/age/weight/gender values and the number of registered athletes. Smoothcomp only creates a division once someone registers in it, so this shows existing demand, not every possible weight class.

Args:
  - event_id (number): Smoothcomp event ID
  - include_divisions (boolean): also fetch divisions (default true)
  - max_division_pages (number): pages of 5 divisions to fetch, 1-60 (default 20, i.e. up to 100 divisions)
  - entry_filter (string, optional): only keep divisions whose entry/name contains this text (e.g. "NO GI", "Master")
  - response_format: 'markdown' or 'json'

Returns entries, the distinct values for each dimension (e.g. Belt: White, Blue...; Weight: -70 kg...), and the division list.`,
      inputSchema: {
        event_id: eventIdSchema,
        include_divisions: z.boolean().default(true).describe("Also list divisions/brackets with registration counts"),
        max_division_pages: z.number().int().min(1).max(60).default(20).describe("Pages of 5 divisions to fetch (default 20)"),
        entry_filter: z.string().optional().describe("Keep only divisions whose name contains this text"),
        response_format: responseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ event_id, include_divisions, max_division_pages, entry_filter, response_format }) => {
      try {
        const ev = await getEventDetails(event_id);
        let divisionsData: Awaited<ReturnType<typeof getEventDivisions>> | null = null;
        let divisionsError: string | null = null;
        if (include_divisions) {
          try {
            divisionsData = await getEventDivisions(event_id, max_division_pages);
          } catch (err) {
            divisionsError = err instanceof Error ? err.message : String(err);
          }
        }

        const filter = entry_filter?.toLowerCase();
        const divisions = (divisionsData?.divisions ?? []).filter(d => !filter || d.name.toLowerCase().includes(filter));
        const dimensions: Record<string, string[]> = {};
        for (const d of divisions) {
          for (const [k, v] of Object.entries(d.values)) (dimensions[k] ??= []).includes(v) || dimensions[k].push(v);
        }
        const partial = divisionsData ? divisionsData.pagesFetched < divisionsData.lastPage : false;

        const data = {
          event_id,
          title: ev.title,
          url: ev.url,
          entries: ev.entries,
          ...(include_divisions
            ? {
                divisions_total_on_smoothcomp: divisionsData?.total ?? null,
                divisions_returned: divisions.length,
                divisions_partial: partial,
                ...(divisionsError ? { divisions_error: divisionsError } : {}),
                dimensions,
                divisions,
              }
            : {}),
        };

        return respond(response_format, data, () => {
          const lines = [`# Categories: ${ev.title} (ID ${event_id})`, ev.url, "", `## Registration options (${ev.entries.length})`];
          lines.push(...(ev.entries.length ? ev.entries.map(entryLine) : ["- None published"]));
          if (include_divisions) {
            lines.push("", `## Divisions (${divisions.length}${divisionsData ? ` of ${divisionsData.total}` : ""})`);
            if (divisionsError) lines.push(`Could not load divisions: ${divisionsError}`);
            else if (!divisions.length) lines.push("No divisions yet (they appear once athletes register).");
            for (const [k, vals] of Object.entries(dimensions)) lines.push(`- ${k}: ${vals.join(", ")}`);
            lines.push("");
            lines.push(...divisions.map(d => `- ${d.name}: ${d.registered} registered${d.pending ? ` (+${d.pending} pending)` : ""}`));
            if (partial) lines.push("", `Only the first ${max_division_pages} pages were fetched; raise max_division_pages to see more.`);
          }
          return lines.join("\n");
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "smoothcomp_get_event_requirements",
    {
      title: "Get participation requirements of a Smoothcomp event",
      description: `Find what an athlete needs to take part in a Smoothcomp competition: licence or federation membership (e.g. licence FFL/FFLDA, FFJDA, IBJJF membership), medical certificate, insurance, ID, parental consent for minors, required equipment/dress code, rank/level rules, weigh-in, plus registration deadlines, prices and refund policy.

Requirements are extracted from the organizer's text (French, English, Spanish, Portuguese, Italian, German keywords) and from registration options (e.g. "LICENCIÉ" vs "NON LICENCIÉ" pricing). Each requirement comes with the exact source sentence.

Args:
  - event_id (number): Smoothcomp event ID
  - include_full_text (boolean): also return the organizer's full information text (default false)
  - response_format: 'markdown' or 'json'

Returns: federations_mentioned, licence_based_pricing, requirements grouped by type (licence_or_membership, medical_certificate, insurance, identity_document, minors_parental_consent, equipment, rank_or_level, weigh_in), entries, registration window, refund policy.`,
      inputSchema: {
        event_id: eventIdSchema,
        include_full_text: z.boolean().default(false).describe("Include the full organizer information text"),
        response_format: responseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ event_id, include_full_text, response_format }) => {
      try {
        const ev = await getEventDetails(event_id);
        const report = extractRequirements(ev);
        const data = include_full_text ? { ...report, info_text: ev.info_text } : report;
        return respond(response_format, data, () => {
          const lines = [`# Requirements: ${ev.title} (ID ${event_id})`, ev.url, ""];
          if (report.federations_mentioned.length) lines.push(`**Federations mentioned:** ${report.federations_mentioned.join(", ")}`, "");
          const keys = Object.keys(report.requirements);
          if (!keys.length) {
            lines.push(
              report.info_text_available
                ? "_No explicit requirement found in the organizer's text._"
                : "_The organizer has not published any information text._"
            );
          }
          for (const k of keys) {
            lines.push(`## ${REQUIREMENT_LABELS[k] ?? k}`, ...report.requirements[k].map(s => `- ${s}`), "");
          }
          lines.push("## Registration", ...registrationLines(report.registration), "");
          lines.push("## Registration options", ...(report.entries.length ? report.entries.map(entryLine) : ["- None published"]), "");
          lines.push("## Refund policy", ...report.refund_policy.map(r => `- ${r}`), "", `_${report.disclaimer}_`);
          if (include_full_text) lines.push("", "## Full information text", ev.info_text || "_None_");
          return lines.join("\n");
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
