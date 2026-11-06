export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let session = null;
let refreshInFlight = null;
const sessionListeners = new Set();

function publishSession(nextSession) {
  session = nextSession;
  for (const listener of sessionListeners) listener(session);
}

function readJson(response) {
  return response.json().catch(() => {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an invalid response.',
    );
  });
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
    );
  }

  return payload;
}

function sessionFromPayload(payload) {
  const data = payload?.data;
  if (!data?.accessToken || !data?.user) {
    throw new ApiError(502, 'INVALID_RESPONSE', 'The server returned an incomplete session.');
  }
  const nextSession = { accessToken: data.accessToken, user: data.user };
  publishSession(nextSession);
  return nextSession;
}

export function subscribeSession(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export async function signup(input) {
  const payload = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sessionFromPayload(payload);
}

export async function login(input) {
  const payload = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sessionFromPayload(payload);
}

export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = requestJson('/api/auth/refresh', { method: 'POST' })
      .then(sessionFromPayload)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) publishSession(null);
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function logout() {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    publishSession(null);
  }
}

export async function apiRequest(path, options = {}) {
  const sentToken = session?.accessToken;
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (sentToken) headers.set('Authorization', `Bearer ${sentToken}`);

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });
  const payload = await readJson(response);

  if (response.status === 401 && sentToken && !options.__retried) {
    try {
      if (session?.accessToken === sentToken) await refreshSession();
      return apiRequest(path, { ...options, __retried: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) publishSession(null);
      throw error;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
    );
  }
  return payload;
}

export async function streamRequest(path, options = {}, retried = false) {
  const sentToken = session?.accessToken;
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (sentToken) headers.set('Authorization', `Bearer ${sentToken}`);

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (response.status === 401 && sentToken && !retried) {
    try {
      if (session?.accessToken === sentToken) await refreshSession();
      return streamRequest(path, options, true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) publishSession(null);
      throw error;
    }
  }
  if (!response.ok) {
    const payload = await readJson(response);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
    );
  }
  return response;
}
