import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { UpstreamError } from "../services/http.js";

export const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("'markdown' for human-readable output, 'json' for structured data");

export const eventIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Smoothcomp event ID, e.g. 35411 (from smoothcomp_search_events or an event URL like smoothcomp.com/en/event/35411)");

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function respond(format: "markdown" | "json", data: object, markdown: () => string): CallToolResult {
  let text = format === "json" ? JSON.stringify(data, null, 2) : markdown();
  if (text.length > CHARACTER_LIMIT) {
    text = `${text.slice(0, CHARACTER_LIMIT)}\n\n…[Response truncated at ${CHARACTER_LIMIT} characters. Narrow your filters or use limit/offset.]`;
  }
  return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
}

/** Pass a string for input-validation problems; anything else is reported as an upstream/unexpected error. */
export function errorResult(err: unknown): CallToolResult {
  const message =
    typeof err === "string" || err instanceof UpstreamError
      ? String(err instanceof UpstreamError ? err.message : err)
      : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}
