import { Logger } from "../index.js";

export type OptimizeBy = "time" | "distance";

export interface RoutePointInput {
  lat: number;
  lng: number;
  label?: string;
}

export interface OptimizeRouteParams {
  origin: RoutePointInput;
  destination: RoutePointInput;
  waypoints: RoutePointInput[];
  optimizeBy: OptimizeBy;
  departureTime?: string;
}

export interface OptimizeRouteResult {
  polyline: string;
  ordered: Array<{ label: string; lat: number; lng: number }>;
  distance_meters: number;
  duration_seconds: number;
  legs: Array<{
    start_label: string;
    end_label: string;
    distance_meters: number;
    duration_seconds: number;
  }>;
  source: "routes_preferred" | "directions_fallback";
}

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

export class RoutesService {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("Google Maps API Key is required for route optimization");
    }
  }

  async optimizeRoute(params: OptimizeRouteParams): Promise<OptimizeRouteResult> {
    try {
      return await this.computeRoutesPreferred(params);
    } catch (error) {
      Logger.error("Routes Preferred failed, falling back to Directions API", error);
      return this.computeDirectionsFallback(params);
    }
  }

  private async computeRoutesPreferred(params: OptimizeRouteParams): Promise<OptimizeRouteResult> {
    const { origin, destination, waypoints, optimizeBy } = params;
    const body = {
      origin: { location: { latLng: this.toLatLng(origin) } },
      destination: { location: { latLng: this.toLatLng(destination) } },
      intermediates: waypoints.map((waypoint) => ({ location: { latLng: this.toLatLng(waypoint) } })),
      travelMode: "DRIVE",
      routingPreference: optimizeBy === "distance" ? "TRAFFIC_UNAWARE" : "TRAFFIC_AWARE_OPTIMAL",
      departureTime: this.resolveDepartureTimeString(params.departureTime),
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
      optimizeWaypointOrder: waypoints.length > 0,
    };

    const response = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": [
          "routes.distanceMeters",
          "routes.duration",
          "routes.polyline.encodedPolyline",
          "routes.legs.distanceMeters",
          "routes.legs.duration",
          "routes.optimizedIntermediateWaypointIndex",
        ].join(","),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorPayload = await this.safeParse(response);
      const upstream = errorPayload?.error?.message || response.statusText;
      throw new Error(`Routes Preferred API error: ${upstream} (HTTP ${response.status})`);
    }

    const payload = await response.json();
    const route = payload?.routes?.[0];
    if (!route) {
      throw new Error("Routes Preferred API returned no routes");
    }

    const optimizedOrder: number[] = route.optimizedIntermediateWaypointIndex || waypoints.map((_, index) => index);
    const orderedWaypoints = optimizedOrder.map((idx) => waypoints[idx]);
    const orderedPoints = [origin, ...orderedWaypoints, destination];
    const legsFromApi = route.legs || [];
    const legs = this.mapLegs(legsFromApi, orderedPoints);

    return {
      polyline: route.polyline?.encodedPolyline || "",
      ordered: orderedPoints.map((point, idx) => this.normalizePoint(point, idx, orderedPoints.length)),
      distance_meters: route.distanceMeters || this.sumDistances(legs),
      duration_seconds: this.parseDurationSeconds(route.duration),
      legs,
      source: "routes_preferred",
    };
  }

  private async computeDirectionsFallback(params: OptimizeRouteParams): Promise<OptimizeRouteResult> {
    const { origin, destination, waypoints } = params;
    const url = new URL(DIRECTIONS_ENDPOINT);
    const searchParams = url.searchParams;
    searchParams.set("origin", `${origin.lat},${origin.lng}`);
    searchParams.set("destination", `${destination.lat},${destination.lng}`);
    searchParams.set("mode", "driving");
    const departureTime = this.resolveDepartureTimeString(params.departureTime, true);
    if (departureTime) {
      searchParams.set("departure_time", departureTime);
    }
    if (waypoints.length > 0) {
      const waypointStrings = waypoints.map((wp) => `${wp.lat},${wp.lng}`);
      // Directions API only optimizes by time, but keeping optimization on yields closest behavior.
      const prefix = "optimize:true|";
      searchParams.set("waypoints", `${prefix}${waypointStrings.join("|")}`);
    }
    searchParams.set("key", this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Directions API HTTP error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    if (data.status !== "OK" || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error(`Directions API error: ${data.status || "UNKNOWN"}`);
    }

    const route = data.routes[0];
    const waypointOrder: number[] = route.waypoint_order || waypoints.map((_, idx) => idx);
    const orderedWaypoints = waypointOrder.map((idx) => waypoints[idx]);
    const orderedPoints = [origin, ...orderedWaypoints, destination];
    const legsFromApi = route.legs || [];
    const legs = this.mapLegs(
      legsFromApi.map((leg: any) => ({
        distanceMeters: leg.distance?.value || 0,
        duration: `${leg.duration_in_traffic?.value || leg.duration?.value || 0}s`,
      })),
      orderedPoints
    );

    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance_meters, 0);
    const totalDuration = legs.reduce((sum, leg) => sum + leg.duration_seconds, 0);

    return {
      polyline: route.overview_polyline?.points || "",
      ordered: orderedPoints.map((point, idx) => this.normalizePoint(point, idx, orderedPoints.length)),
      distance_meters: totalDistance,
      duration_seconds: totalDuration,
      legs,
      source: "directions_fallback",
    };
  }

  private normalizePoint(point: RoutePointInput, index: number, total: number) {
    return {
      label: point.label || this.defaultLabel(index, total),
      lat: point.lat,
      lng: point.lng,
    };
  }

  private mapLegs(legsFromApi: Array<{ distanceMeters?: number; duration?: string }>, orderedPoints: RoutePointInput[]) {
    return legsFromApi.map((leg, idx) => {
      const startPoint = orderedPoints[idx] || orderedPoints[0];
      const endPoint = orderedPoints[idx + 1] || orderedPoints[orderedPoints.length - 1];
      return {
        start_label: this.normalizePoint(startPoint, idx, orderedPoints.length).label,
        end_label: this.normalizePoint(endPoint, idx + 1, orderedPoints.length).label,
        distance_meters: leg.distanceMeters || 0,
        duration_seconds: this.parseDurationSeconds(leg.duration),
      };
    });
  }

  private toLatLng(point: RoutePointInput) {
    return {
      latitude: point.lat,
      longitude: point.lng,
    };
  }

  private defaultLabel(index: number, total: number): string {
    if (index === 0) return "Origin";
    if (index === total - 1) return "Destination";
    return `Stop ${index}`;
  }

  private sumDistances(legs: OptimizeRouteResult["legs"]): number {
    return legs.reduce((sum, leg) => sum + leg.distance_meters, 0);
  }

  private parseDurationSeconds(duration?: string | null): number {
    if (!duration) {
      return 0;
    }
    const match = /([0-9.]+)s/.exec(duration);
    if (!match) {
      return 0;
    }
    return Math.round(parseFloat(match[1]));
  }

  private resolveDepartureTimeString(value?: string, allowNowLiteral = false): string {
    if (!value || value === "now") {
      return allowNowLiteral ? "now" : new Date().toISOString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return allowNowLiteral ? "now" : new Date().toISOString();
    }
    return allowNowLiteral ? Math.floor(date.getTime() / 1000).toString() : date.toISOString();
  }

  private async safeParse(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
}
