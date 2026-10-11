// Fetch wrapper for the JSON API.

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: object): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText, data ?? {});
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: object) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: object) => request<T>('PATCH', url, body),
};
