'use strict';

// Fixed origins: neither prompts nor webhook data can choose a credential destination.
class ApiError extends Error {
  constructor(service, status) {
    super(`${service} request failed (${status || 'network/timeout'}). Check credentials, permissions, and service status.`);
    this.status = status;
    this.service = service;
  }
}

function client(origin, token, service, fetchImpl = fetch) {
  if (!token) throw new Error(`Missing ${service} credential.`);
  return async (method, path, body) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path.');
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(service === 'GitHub' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (_) { throw new ApiError(service, 0); }
    // Never log remote bodies: they can echo credentials, prompts, or arbitrary content.
    if (!response.ok) throw new ApiError(service, response.status);
    if (response.status === 204) return null;
    try { return await response.json(); } catch (_) { throw new ApiError(service, response.status); }
  };
}

module.exports = { client, ApiError };
