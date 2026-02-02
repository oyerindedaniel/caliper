/**
 * Simple internal ID generator for the MCP server.
 */
export function generateId(prefix: string = ""): string {
  const randomPart = Math.random().toString(36).substring(2, 11);
  return prefix ? `${prefix}-${randomPart}` : randomPart;
}
