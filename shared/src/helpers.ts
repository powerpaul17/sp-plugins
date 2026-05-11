export const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

export const isAuthError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && typeof (err as Record<string, unknown>).status === 'number'
    ? [401, 403, 404].includes((err as { status: number }).status)
    : false;

export function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
