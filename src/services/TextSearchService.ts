import { Logger } from "../index.js";

interface RawPlace {
  name?: string;
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  viewport?: {
    low?: { latitude?: number; longitude?: number };
    high?: { latitude?: number; longitude?: number };
  };
}

export interface TextSearchCandidate {
  place_id: string;
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  types: string[];
  is_area: boolean;
}

export interface TextSearchResult {
  resolved: boolean;
  candidates: TextSearchCandidate[];
}

export class TextSearchService {
  private readonly endpoint = "https://places.googleapis.com/v1/places:searchText";
  private readonly apiKey: string;
  private readonly defaultLanguage = "en";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("Google Maps API Key is required for text search");
    }
  }

  async search(query: string, maxResults = 5, languageCode = this.defaultLanguage): Promise<TextSearchResult> {
    const body = {
      textQuery: query,
      maxResultCount: Math.max(1, Math.min(20, maxResults)),
      languageCode,
    };

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.name",
            "places.displayName",
            "places.formattedAddress",
            "places.location",
            "places.types",
            "places.viewport",
          ].join(","),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await this.safeParseJson(response);
        const upstreamMessage = errorBody?.error?.message || response.statusText;
        throw new Error(`Places text search failed: ${upstreamMessage} (HTTP ${response.status})`);
      }

      const payload = await response.json();
      const places: RawPlace[] = payload?.places || [];
      const candidates = places.map((place, index) => this.transformCandidate(place, index));
      const resolved = candidates.length === 1 && !candidates[0].is_area;

      return { resolved, candidates };
    } catch (error) {
      Logger.error("places_text_search error", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Places text search failed: ${JSON.stringify(error)}`);
    }
  }

  private transformCandidate(place: RawPlace, index: number): TextSearchCandidate {
    const lat = place.location?.latitude ?? 0;
    const lng = place.location?.longitude ?? 0;
    const types = place.types || [];
    const isArea = this.isArea(types, place.viewport);

    return {
      place_id: this.extractPlaceId(place),
      name: place.displayName?.text || place.name || `Candidate ${index + 1}`,
      formatted_address: place.formattedAddress || "",
      lat,
      lng,
      types,
      is_area: isArea,
    };
  }

  private extractPlaceId(place: RawPlace): string {
    if (place.name && place.name.startsWith("places/")) {
      return place.name.replace("places/", "");
    }
    return place.id || "";
  }

  private isArea(types: string[], viewport?: RawPlace["viewport"]): boolean {
    const areaTokens = [
      "administrative_area_level",
      "locality",
      "sublocality",
      "postal_code",
      "country",
      "plus_code",
      "colloquial_area",
      "neighborhood",
      "political",
    ];
    const matchesType = types.some((type) => areaTokens.some((token) => type.includes(token)));

    if (matchesType) {
      return true;
    }

    if (viewport?.low && viewport?.high) {
      const latSpan = Math.abs((viewport.high.latitude ?? 0) - (viewport.low.latitude ?? 0));
      const lngSpan = Math.abs((viewport.high.longitude ?? 0) - (viewport.low.longitude ?? 0));
      if (latSpan > 0.05 || lngSpan > 0.05) {
        // Roughly larger than ~5km span
        return true;
      }
    }

    return false;
  }

  private async safeParseJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
}
