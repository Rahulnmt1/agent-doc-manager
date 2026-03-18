import getClient from "../../server/redis";

const TEST_KEY_PATTERNS = [
  "users:*",
  "semantic-memory:*",
  "documents:*",
  "document-chunks:*",
  "projects:*",
  "session:*",
];

export async function getTestRedis() {
  const redis = await getClient();
  await redis.ping();
  return redis;
}

export async function flushTestData() {
  const redis = await getTestRedis();

  for (const pattern of TEST_KEY_PATTERNS) {
    const keys = await redis.keys(pattern);

    if (Array.isArray(keys) && keys.length > 0) {
      await redis.del(keys);
    }
  }
}
