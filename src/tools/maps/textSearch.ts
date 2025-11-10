import { z } from "zod";
import { TextSearchService } from "../../services/TextSearchService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "places_text_search";
const DESCRIPTION = "Global text search that returns candidate places with precision flags";

const SCHEMA = {
  query: z.string().min(2).describe("Free-form text to resolve into places"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of candidates to return (1-20)"),
  languageCode: z.string().optional().describe("BCP-47 language code (default en)"),
};

export type TextSearchParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: TextSearchParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const service = new TextSearchService(apiKey);
    const maxResults = params.maxResults ?? 5;
    const languageCode = params.languageCode || undefined;
    const result = await service.search(params.query, maxResults, languageCode);

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
      content: [{ type: "text", text: `places_text_search failed: ${errorMessage}` }],
    };
  }
}

export const TextSearch = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
