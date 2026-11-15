/**
 * Only in-app paths may be used to return after sign-in. "//host" and "/\host" are treated by
 * browsers as other sites, so accepting them would allow redirecting users to a foreign page.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
