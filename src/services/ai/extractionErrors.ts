function getErrorResponse(data: unknown): {
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
} {
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  return {
    message: typeof record.error === 'string' ? record.error : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
    retryAfterSeconds: typeof record.retryAfter === 'number'
      && Number.isFinite(record.retryAfter)
      && record.retryAfter >= 0
      ? record.retryAfter
      : undefined,
  };
}

function getRetryAfterHeaderMs(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

export async function readExtractionErrorResponse(
  response: Response,
  nowMs = Date.now(),
): Promise<{ message: string; code?: string; retryAfterMs?: number }> {
  const body = await response.text();
  let errorData: ReturnType<typeof getErrorResponse> = {};
  try {
    errorData = getErrorResponse(JSON.parse(body));
  } catch {
    // Proxy and platform error pages are deliberately not exposed to users.
  }

  return {
    message: errorData.message ?? 'Extraction service returned an error.',
    code: errorData.code,
    retryAfterMs: errorData.retryAfterSeconds != null
      ? errorData.retryAfterSeconds * 1000
      : getRetryAfterHeaderMs(response.headers.get('Retry-After'), nowMs),
  };
}
