import { GEOCODER_USER_AGENT, NOMINATIM_URL } from "../constants.js";
import { TtlCache, getJson, UpstreamError } from "./http.js";

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label: string;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const geocodeCache = new TtlCache<GeoPoint>(24 * 60 * 60 * 1000);

/** Geocodes a free-text place via OpenStreetMap Nominatim. */
export function geocode(place: string): Promise<GeoPoint> {
  return geocodeCache.get(place.toLowerCase(), async () => {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`;
    const results = await getJson<Array<{ lat: string; lon: string; display_name: string }>>(url, {
      "User-Agent": GEOCODER_USER_AGENT,
    });
    if (!results.length) {
      throw new UpstreamError(
        `Could not geocode "${place}". Try a more specific place (e.g. "Lyon, France") or pass latitude/longitude directly.`
      );
    }
    return { latitude: Number(results[0].lat), longitude: Number(results[0].lon), label: results[0].display_name };
  });
}
