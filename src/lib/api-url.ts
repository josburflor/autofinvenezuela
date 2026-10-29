const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

function backendUrl(path: string): URL {
  const origin = configuredOrigin || window.location.origin;
  return new URL(path, origin);
}

export function apiUrl(path: string): string {
  return backendUrl(path).toString();
}

export function websocketUrl(path: string): string {
  const url = backendUrl(path);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(input), init);
}
