import "dotenv/config";

process.env.REDIS_URL ??= "redis://localhost:6300";
process.env.CRAWL_SOURCE ??= "local";
