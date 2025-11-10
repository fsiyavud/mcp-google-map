import { jest } from '@jest/globals';
import { RoutesService } from '../src/services/RoutesService.js';

const originalFetch = global.fetch;
const asFetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

describe('RoutesService', () => {
  const origin = { lat: 1, lng: 2, label: 'Origin' };
  const destination = { lat: 4, lng: 5, label: 'Destination' };
  const waypoints = [
    { lat: 2, lng: 3, label: 'Stop A' },
    { lat: 3, lng: 4, label: 'Stop B' },
  ];

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    asFetchMock().mockReset();
    global.fetch = originalFetch;
  });

  it('prefers Routes Preferred API responses when available', async () => {
    asFetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          {
            distanceMeters: 12000,
            duration: '800s',
            polyline: { encodedPolyline: 'abc123' },
            optimizedIntermediateWaypointIndex: [1, 0],
            legs: [
              { distanceMeters: 4000, duration: '250s' },
              { distanceMeters: 5000, duration: '300s' },
              { distanceMeters: 3000, duration: '250s' },
            ],
          },
        ],
      }),
    } as unknown as Response);

    const service = new RoutesService();
    const result = await service.optimizeRoute({
      origin,
      destination,
      waypoints,
      optimizeBy: 'time',
      departureTime: 'now',
    });

    expect(result.source).toBe('routes_preferred');
    expect(result.polyline).toBe('abc123');
    expect(result.ordered.map((p) => p.label)).toEqual(['Origin', 'Stop B', 'Stop A', 'Destination']);
    expect(result.legs).toHaveLength(3);
    expect(result.distance_meters).toBe(12000);
    expect(result.duration_seconds).toBe(800);
  });

  it('falls back to Directions API when Routes Preferred fails', async () => {
    asFetchMock()
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: async () => ({ error: { message: 'boom' } }),
      }) as unknown as Response)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          status: 'OK',
          routes: [
            {
              overview_polyline: { points: 'fallback' },
              waypoint_order: [1, 0],
              legs: [
                {
                  distance: { value: 3000 },
                  duration_in_traffic: { value: 200 },
                },
                {
                  distance: { value: 4000 },
                  duration_in_traffic: { value: 250 },
                },
                {
                  distance: { value: 5000 },
                  duration_in_traffic: { value: 300 },
                },
              ],
            },
          ],
        }),
      }) as unknown as Response);

    const service = new RoutesService();
    const result = await service.optimizeRoute({
      origin,
      destination,
      waypoints,
      optimizeBy: 'distance',
      departureTime: 'now',
    });

    expect(result.source).toBe('directions_fallback');
    expect(result.polyline).toBe('fallback');
    expect(result.distance_meters).toBe(12000);
    expect(result.duration_seconds).toBe(750);
    expect(result.ordered.map((p) => p.label)).toEqual(['Origin', 'Stop B', 'Stop A', 'Destination']);
  });
});
