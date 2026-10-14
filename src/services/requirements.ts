import type { EventDetails } from "../types.js";
import { normalize } from "./text.js";

/** Multilingual (FR/EN/ES/PT/IT/DE) patterns, applied to accent-stripped lowercase text. */
const RULES: Record<string, RegExp> = {
  licence_or_membership:
    /licen[cs]|lizenz|tessera|membership|member of|membre d|adhesion|adherent|affiliat|affilie|filiad|federad|carteira|smoothcomp (verified|verification)/,
  medical_certificate:
    /certificat medical|medical (certificate|clearance|exam|form)|attestation (de )?sante|questionnaire (de )?sante|atestado medico|certificado medico|arztlich|certificato medico|\bpps\b|parcours prevention sante/,
  insurance: /assurance|insurance|seguro|versicherung|assicurazion/,
  identity_document: /piece d.identite|carte d.identite|identity (card|document)|photo id|\bid card\b|passport|passeport|documento de identi|ausweis/,
  minors_parental_consent: /autorisation parentale|parental (consent|permission|authori[sz]ation)|waiver|decharge|autorizacion|autorizacao|einverstandnis/,
  equipment: /kimono|rash ?guard|protege[- ]?dents|mouth ?guard|coquille|groin (guard|protector)|headgear|casque|protections? (obligatoire|required|mandatory)|shin ?guards?|protege[- ]?tibias|gloves|gants|dress code|tenue/,
  rank_or_level: /ceinture (verifi|obligatoire)|belt (verification|certificate|proof)|certificate of rank|diplome|grade (obligatoire|required)|niveau requis|experience (required|minimum)/,
  weigh_in: /pesee|weigh[- ]?in|pesaje|pesagem|wiegen/,
};

const FEDERATION_ACRONYM =
  /\b(FF[A-Z]{1,6}|IBJJF|CBJJ|UAEJJF|AJP|JJIF|UWW|FILA|ADCC|NAGA|SJJIF|FIJJB|CFJJB|UEJJ|FJJB|WAKO|IFMA|FIAS|ISKA|IMMAF|USAW|UFLDA|ACB ?JJ|GFTeam)\b/g;
const FEDERATION_NAME = /F[ée]d[ée]ration [A-ZÉ][^,.;:\n()]{3,70}|Federaci[óo]n [A-Z][^,.;:\n()]{3,70}|Federa[çc][ãa]o [A-Z][^,.;:\n()]{3,70}|Federation [A-Z][^,.;:\n()]{3,70}/g;

const MAX_SNIPPETS_PER_RULE = 6;
const MAX_SNIPPET_LENGTH = 400;
const MAX_LICENCE_ENTRIES_SHOWN = 6;

function splitIntoSnippets(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const snippets: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^#+\s*/, "");
    // Headings like "LICENCE :" carry their meaning in the following line.
    if (/[:：]\s*$/.test(line) && lines[i + 1]) line = `${line} ${lines[++i].replace(/^#+\s*/, "")}`;
    if (line.length <= MAX_SNIPPET_LENGTH) snippets.push(line);
    else snippets.push(...(line.match(/[^.!?]+[.!?]*/g) ?? [line]).map(s => s.trim()).filter(Boolean));
  }
  return snippets;
}

export interface RequirementReport {
  event_id: number;
  title: string;
  url: string;
  federations_mentioned: string[];
  licence_based_pricing: boolean;
  requirements: Record<string, string[]>;
  entries: EventDetails["entries"];
  registration: EventDetails["registration"];
  refund_policy: string[];
  organizer: string | null;
  info_text_available: boolean;
  disclaimer: string;
}

export function extractRequirements(ev: EventDetails): RequirementReport {
  const snippets = splitIntoSnippets(ev.info_text);
  const requirements: Record<string, string[]> = {};
  for (const [key, re] of Object.entries(RULES)) {
    const hits = [...new Set(snippets.filter(s => re.test(normalize(s))))].slice(0, MAX_SNIPPETS_PER_RULE);
    if (hits.length) requirements[key] = hits.map(s => s.slice(0, MAX_SNIPPET_LENGTH));
  }

  const corpus = `${ev.info_text}\n${ev.entries.map(e => `${e.title} ${e.description}`).join("\n")}`;
  const federations = new Set<string>();
  for (const m of corpus.matchAll(FEDERATION_ACRONYM)) federations.add(m[1].replace(/\s+/g, ""));
  for (const m of corpus.matchAll(FEDERATION_NAME)) federations.add(m[0].trim());

  const licenceEntries = ev.entries.filter(e => RULES.licence_or_membership.test(normalize(`${e.title} ${e.description}`)));
  if (licenceEntries.length) {
    const shown = licenceEntries.slice(0, MAX_LICENCE_ENTRIES_SHOWN).map(e => `${e.title}${e.price !== null ? ` (${e.price} ${e.currency ?? ""})` : ""}`.trim());
    const more = licenceEntries.length - shown.length;
    requirements.licence_or_membership = [
      `${licenceEntries.length} registration option(s) depend on licence status: ${shown.join("; ")}${more > 0 ? `; …and ${more} more (see entries)` : ""}`,
      ...(requirements.licence_or_membership ?? []),
    ];
  }

  return {
    event_id: ev.id,
    title: ev.title,
    url: ev.url,
    federations_mentioned: [...federations],
    licence_based_pricing: licenceEntries.length > 0,
    requirements,
    entries: ev.entries,
    registration: ev.registration,
    refund_policy: ev.refund_policy,
    organizer: ev.organizer?.name ?? null,
    info_text_available: ev.info_text.trim().length > 0,
    disclaimer:
      "Requirements are extracted automatically from the organizer's text. When nothing is found it may simply not be written on Smoothcomp; check the full info text (include_full_text=true) or contact the organizer.",
  };
}

export const REQUIREMENT_LABELS: Record<string, string> = {
  licence_or_membership: "Licence / federation membership",
  medical_certificate: "Medical certificate",
  insurance: "Insurance",
  identity_document: "ID document",
  minors_parental_consent: "Minors / parental consent / waiver",
  equipment: "Equipment & dress code",
  rank_or_level: "Rank / level",
  weigh_in: "Weigh-in",
};
