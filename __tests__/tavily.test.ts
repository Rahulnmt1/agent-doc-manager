import { beforeEach, describe, expect, mock, test } from "bun:test";

const extractMock = mock(
  async (urls: string[], _options: { format: string }) => {
    return {
      results: urls.map((url) => ({
        url,
        rawContent: `content for ${url}`,
      })),
    };
  },
);

const crawlMock = mock(
  async (
    url: string,
    options: { instructions: string; format: string; limit: number },
  ) => {
    return {
      results: [
        {
          url,
          rawContent: `crawled with ${options.instructions}`,
        },
      ],
    };
  },
);

mock.module("@tavily/core", () => ({
  tavily: () => ({
    extract: extractMock,
    crawl: crawlMock,
  }),
}));

describe("Tavily service", () => {
  beforeEach(() => {
    extractMock.mockClear();
    crawlMock.mockClear();
    process.env.TAVILY_API_KEY = "test-key";
  });

  test("extract chunks URL batches larger than 20 items", async () => {
    const tavily = await import("../server/services/tavily/tavily");
    const urls = Array.from({ length: 25 }, (_, index) => {
      return `https://example.com/${index}`;
    });

    const response = await tavily.extract(urls);

    expect(extractMock).toHaveBeenCalledTimes(2);
    expect(response.results).toHaveLength(25);
  });

  test("crawl forwards instructions to Tavily", async () => {
    const tavily = await import("../server/services/tavily/tavily");
    const results = await tavily.crawl(
      "https://example.com/docs",
      "Find tutorial pages.",
    );

    expect(crawlMock).toHaveBeenCalledTimes(1);
    expect(results[0]?.rawContent).toContain("Find tutorial pages.");
  });
});
