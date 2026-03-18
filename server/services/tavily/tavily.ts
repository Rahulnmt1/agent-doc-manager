import { tavily } from "@tavily/core";
import config from "../../config";

function getClient() {
  if (!config.tavily.API_KEY) {
    throw new Error(
      "No Tavily API key configured. Set TAVILY_API_KEY to enable live crawl mode.",
    );
  }

  return tavily({
    apiKey: config.tavily.API_KEY,
  });
}

export async function extract(urls: string[]) {
  const chunkSize = 20;
  const client = getClient();

  if (urls.length > chunkSize) {
    const chunks = [];
    for (let i = 0; i < urls.length; i += chunkSize) {
      chunks.push(urls.slice(i, i + chunkSize));
    }

    const results = [];
    for (const chunk of chunks) {
      const res = await client.extract(chunk, {
        format: "markdown",
      });
      results.push(...res.results);
    }

    return { results };
  }

  return client.extract(urls, {
    format: "markdown",
  });
}

export async function crawl(url: string, instructions: string) {
  const client = getClient();
  const response = await client.crawl(url, {
    instructions,
    format: "markdown",
    limit: 3,
  });

  return response.results;
}
