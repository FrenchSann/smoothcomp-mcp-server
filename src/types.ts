/** Raw event as embedded in the /events/upcoming page. */
export interface RawListedEvent {
  id: number;
  title: string;
  url: string;
  eventPeriod: string;
  eventEnded: boolean;
  days_to_start: number;
  location_country: string;
  location_country_human: string;
  location_city: string;
  location_lat: string;
  location_long: string;
  categoryGroups: string[];
  startdate: string;
  enddate: string;
}

export interface Sport {
  id: number;
  name: string;
  group: string;
}

export interface ListedEvent {
  id: number;
  title: string;
  url: string;
  start_date: string;
  end_date: string;
  period: string;
  days_to_start: number;
  country_code: string;
  country: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  sports: string[];
  sport_ids: number[];
  distance_km?: number;
}

export interface EventEntry {
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  description: string;
}

export interface RawInfoPanels {
  organizer?: { id: number; name: string; company?: string; city?: string; country?: string; email?: string; phone?: string };
  previousEvents?: number;
  organizerSince?: string;
  refundData?: Array<{ refund_type?: string; refund_percentage?: number; refund_until?: string }>;
  eventDates?: Record<string, string | null>;
  visibleEntries?: Record<string, { title: string; price?: number; currency?: string; description?: string }>;
  eventMap?: { id: number; title: string; lat: string; lng: string; start_date: number; end_date: number };
  location?: { location_venue?: string | null; location_address?: string | null; location_country?: string; location_city?: string; location_country_human?: string };
  timezone?: string;
}

export interface EditorBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface RawCmsData {
  infoPageBlocks?: EditorBlock[];
  infoPage?: { title?: string; intro_text?: string | null; custom_html?: string | null } | null;
  eventData?: {
    title?: string;
    description?: string;
    early_bird?: number;
    late_entry?: number;
    registration_start?: { date: string; time: string };
    registration_end?: { date: string; time: string };
    late_entry_end?: { date: string; time: string };
    event_start?: string;
    event_end?: string;
  };
}

export interface RawDivisionCategory {
  category_id: number;
  value_id: number;
  name: string;
  category_name?: string;
}

export interface RawRegistration {
  categories?: RawDivisionCategory[];
}

export interface RawDivision {
  id: number;
  name: string;
  entry?: { id: number; name: string } | null;
  categories?: RawDivisionCategory[];
  registrations?: RawRegistration[] | Record<string, RawRegistration> | null;
  incompleteRegistrations?: RawRegistration[] | Record<string, RawRegistration> | null;
}

export interface RawDivisionPage {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  data: RawDivision[];
}

export interface Division {
  name: string;
  entry: string | null;
  values: Record<string, string>;
  registered: number;
  pending: number;
}

export interface EventDetails {
  id: number;
  url: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  venue: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  organizer: { name: string; city: string | null; country: string | null; previous_events: number | null; on_smoothcomp_since: string | null } | null;
  registration: {
    opens: string | null;
    closes: string | null;
    late_entry_until: string | null;
    early_bird: boolean;
    edit_until: string | null;
    cancel_until: string | null;
  };
  refund_policy: string[];
  entries: EventEntry[];
  info_text: string;
}
