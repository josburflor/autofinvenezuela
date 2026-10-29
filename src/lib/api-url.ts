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

export interface SafeBackendResponse<T> {
  backendAvailable: boolean;
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Safely calls an Express `/api/*` endpoint. When deployed on static Firebase Hosting
 * without a separate backend origin, SPA rewrites return `text/html` instead of JSON;
 * this helper detects that cleanly without throwing JSON parse errors.
 */
export async function tryBackendJson<T>(
  input: string,
  init?: RequestInit,
  customFetcher: (url: string, reqInit?: RequestInit) => Promise<Response> = apiFetch
): Promise<SafeBackendResponse<T>> {
  try {
    const res = await customFetcher(input, init);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return {
        backendAvailable: false,
        ok: false,
        status: res.status,
        data: null,
      };
    }
    const parsed = (await res.json()) as T & { error?: string };
    return {
      backendAvailable: true,
      ok: res.ok,
      status: res.status,
      data: parsed,
      error: !res.ok ? parsed?.error || `HTTP ${res.status}` : undefined,
    };
  } catch {
    return {
      backendAvailable: false,
      ok: false,
      status: 0,
      data: null,
    };
  }
}
