import { jest } from '@jest/globals';
import { TextSearchService } from '../src/services/TextSearchService.js';

const originalFetch = global.fetch;
const asFetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

describe('TextSearchService', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    asFetchMock().mockReset();
    global.fetch = originalFetch;
  });

  it('marks result as resolved when a single precise candidate is returned', async () => {
    asFetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            name: 'places/abc',
            displayName: { text: 'Cafe 123' },
            formattedAddress: '123 Main St',
            location: { latitude: 1.1, longitude: 2.2 },
            types: ['point_of_interest', 'establishment'],
          },
        ],
      }),
    } as unknown as Response);

    const service = new TextSearchService();
    const result = await service.search('Cafe 123');

    expect(result.resolved).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      place_id: 'abc',
      is_area: false,
      name: 'Cafe 123',
    });
  });

  it('flags area-like candidates using types and viewport heuristics', async () => {
    asFetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            name: 'places/area',
            displayName: { text: 'Metro Region' },
            formattedAddress: 'Metro Region',
            location: { latitude: 3, longitude: 4 },
            types: ['locality', 'political'],
            viewport: {
              low: { latitude: 2, longitude: 3 },
              high: { latitude: 5, longitude: 6 },
            },
          },
          {
            name: 'places/poi',
            displayName: { text: 'HQ' },
            formattedAddress: '1 Office Plaza',
            location: { latitude: 3.1, longitude: 4.1 },
            types: ['establishment'],
          },
        ],
      }),
    } as unknown as Response);

    const service = new TextSearchService();
    const result = await service.search('Metro HQ', 5);

    expect(result.resolved).toBe(false);
    expect(result.candidates[0].is_area).toBe(true);
    expect(result.candidates[1].is_area).toBe(false);
  });

  it('throws a descriptive error when Google responds with a failure status', async () => {
    asFetchMock().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'API key invalid' } }),
    } as unknown as Response);

    const service = new TextSearchService();
    await expect(service.search('bad')).rejects.toThrow('API key invalid');
  });
});
