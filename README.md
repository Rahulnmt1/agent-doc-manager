# Redis document agent

This app is a Bun + Express document agent that uses Redis for:

- Session storage
- Short-term chat history
- Long-term, episodic, and semantic memory
- JSON document storage
- Vector search over document chunks
- Redis Streams-backed logging

By default, the app runs in a deterministic local demo mode that loads bundled markdown docs from `data/documents` into Redis. You can optionally switch to live crawl mode with Tavily.

## Requirements

- [Bun](https://bun.sh/)
- [Docker](https://www.docker.com/) for the bundled Redis service
- One LLM provider key
  - Recommended: OpenAI
  - Optional: Google Vertex AI or Anthropic

## Quick start

1. Create a local env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
bun install
```

3. Start Redis in Docker:

```bash
bun run docker:redis
```

4. Start the app:

```bash
bun run dev
```

Open `http://localhost:8080`.

## Demo modes

### Local demo mode

This is the default mode.

- `CRAWL_SOURCE=local`
- The app loads bundled docs from `data/documents`
- No Tavily key is required
- Best fit for the tutorial flow and local testing

### Live crawl mode

Switch to Tavily-backed crawl when you want live document ingestion.

```bash
CRAWL_SOURCE=tavily
TAVILY_API_KEY=...
```

In live crawl mode, the app uses the URL and crawl instructions extracted from the project prompt.

## Scripts

```bash
bun run dev         # app + CSS watcher
bun run test        # test suite
bun run ts          # TypeScript checks
bun run build       # production build
bun run format      # Prettier
bun run docker      # Redis + app in Docker
bun run docker:redis
```

## Redis setup

The bundled Docker setup uses:

- `redis:alpine`
- Port `6300` on the host
- `redis://redis:6379` inside Compose

For local development outside Docker, the app reads `REDIS_URL` from `.env`.

## Redis Cloud

You can also point the app at Redis Cloud by setting `REDIS_URL` to your Redis Cloud connection string.

Example:

```bash
REDIS_URL="redis://default:<password>@redis-xxxxx.region.provider.redns.redis-cloud.com:12345"
```

## What the app does

1. Create a project and provide a title plus a working brief.
2. Load source docs into Redis.
3. Chunk and embed those docs for vector search.
4. Ask questions over the indexed docs.
5. Edit markdown and reuse editing preferences through Redis-backed memory.

## Learn more

- [Redis docs](https://redis.io/docs/latest/)
- [Redis tutorials](https://redis.io/tutorials/)
- [Redis Cloud](https://redis.io/try-free/)
