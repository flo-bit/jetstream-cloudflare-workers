export function getCollections(env: { COLLECTIONS: string }): string[] {
  return env.COLLECTIONS.split(",").map((s) => s.trim()).filter(Boolean);
}
