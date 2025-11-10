import { z } from "zod";
import { RoutesService } from "../../services/RoutesService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "routes_optimize";
const DESCRIPTION = "Optimize waypoint order and return a polyline with distance/time summaries";

const waypointSchema = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees"),
  lng: z.number().min(-180).max(180).describe("Longitude in decimal degrees"),
  label: z.string().optional().describe("Human-friendly label for this stop"),
});

const SCHEMA = {
  origin: waypointSchema.describe("Starting point"),
  destination: waypointSchema.describe("Ending point"),
  waypoints: z
    .array(waypointSchema)
    .max(23)
    .default([])
    .describe("Intermediate stops to reorder for the best route"),
  optimize_by: z.enum(["time", "distance"]).default("time").describe("Optimize for shortest travel time (traffic-aware) or distance"),
  departure_time: z.string().default("now").describe("Use 'now' for immediate departure or provide an ISO timestamp"),
};

export type RoutesOptimizeParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: RoutesOptimizeParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const service = new RoutesService(apiKey);
    const result = await service.optimizeRoute({
      origin: params.origin,
      destination: params.destination,
      waypoints: params.waypoints || [],
      optimizeBy: params.optimize_by,
      departureTime: params.departure_time,
    });

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `routes_optimize failed: ${errorMessage}` }],
    };
  }
}

export const RoutesOptimize = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
