import type { Validator } from './schema';

import { ApiError, serverCode } from './errors';

export type QueryValue = boolean | null | number | string | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: string;
  query?: Query;
  /** JSON request body. */
  body?: unknown;
  /** Raw request body, sent as application/octet-stream unless a type is given. */
  bytes?: Blob;
  headers?: Record<string, string>;
  /** Idempotency key. Retrying an unknown outcome must reuse the same key. */
  key?: string;
  signal?: AbortSignal;
  /** Milliseconds before the request is abandoned. */
  timeout?: number;
  /** Explicit JSON response budget for bounded detail contracts, at most 16 MiB. */
  maxJsonBytes?: number;
  /** JSON endpoints never redirect; downloads may follow a signed delivery URL. */
  redirect?: RequestRedirect;
}

export interface HttpOptions {
  /** Share a single account check after a service outage. Writes are never replayed. */
  onUnavailable?: () => void;
  /** Called when the server rejects the current account (401/403). */
  onDenied?: (status: number) => void;
}

const jsonLimit = 4 * 1024 * 1024;
const errorLimit = 64 * 1024;
const readMethods = new Set(['GET', 'HEAD']);

export function queryString(values: Query = {}) {
  const entries = Object.entries(values)
    .filter(
      (entry): entry is [string, boolean | number | string] =>
        entry[1] !== undefined && entry[1] !== null && entry[1] !== '',
    )
    .map(([key, value]) => [key, String(value)]);
  return entries.length > 0
    ? `?${new URLSearchParams(entries).toString()}`
    : '';
}

export const segment = (value: string) => encodeURIComponent(value);

async function readChunksLimited(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<{ chunks: Uint8Array<ArrayBuffer>[]; length: number }> {
  if (!response.body) return { chunks: [], length: 0 };
  const reader = response.body.getReader();
  if (signal?.aborted) {
    void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // Cancellation is still settling.
    }
    throw new DOMException('aborted', 'AbortError');
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  let onAbort: (() => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(new DOMException('aborted', 'AbortError'));
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : undefined;
  try {
    for (;;) {
      const { done, value } = await (aborted
        ? Promise.race([reader.read(), aborted])
        : reader.read());
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError('capacity_exceeded');
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Pending stream read after abort releases once cancellation settles.
    }
  }
  return { chunks, length };
}

function concatChunks(
  chunks: Uint8Array<ArrayBuffer>[],
  length: number,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Read at most `limit` bytes so a broken or hostile response cannot exhaust memory. */
export async function readLimited(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const { chunks, length } = await readChunksLimited(response, limit, signal);
  return concatChunks(chunks, length);
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class Http {
  constructor(
    private readonly fetcher: typeof fetch,
    private readonly options: HttpOptions = {},
  ) {}

  /** Download a bounded binary response without duplicating contiguous byte buffers. */
  async blob(
    path: string,
    limit: number,
    options: RequestOptions = {},
  ): Promise<Blob> {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new ApiError('invalid_input');
    return this.execute(
      path,
      {
        timeout: 120_000,
        redirect: 'follow',
        ...options,
        headers: { Accept: '*/*', ...options.headers },
      },
      async (response, signal, timedOut, write) => {
        const { chunks } = await this.readBody(
          response,
          limit,
          signal,
          options.signal,
          timedOut,
          write,
        );
        return new Blob(chunks, {
          type:
            response.headers.get('Content-Type') ?? 'application/octet-stream',
        });
      },
    );
  }

  /** Send a request and validate the JSON response against the contract. */
  async json<T>(
    path: string,
    validate: Validator<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const limit = options.maxJsonBytes ?? jsonLimit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 * 1024)
      throw new ApiError('invalid_input');
    return this.execute(
      path,
      options,
      async (response, signal, timedOut, write) => {
        const { chunks, length } = await this.readBody(
          response,
          limit,
          signal,
          options.signal,
          timedOut,
          write,
        );
        let value: unknown;
        try {
          value = parseJson(concatChunks(chunks, length));
        } catch {
          throw new ApiError('incompatible', write, response.status);
        }
        try {
          return validate(value);
        } catch {
          throw new ApiError('incompatible', write, response.status);
        }
      },
    );
  }

  /** Send a request and return the successful response. Failures become ApiError. */
  async send(path: string, options: RequestOptions = {}): Promise<Response> {
    return this.execute(path, options, async (response) => response);
  }

  private async execute<T>(
    path: string,
    options: RequestOptions,
    consume: (
      response: Response,
      signal: AbortSignal,
      timedOut: AbortSignal,
      write: boolean,
    ) => Promise<T>,
  ): Promise<T> {
    if (!path.startsWith('/api/')) throw new ApiError('invalid_input');
    const method = (options.method ?? 'GET').toUpperCase();
    const write = !readMethods.has(method);
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), options.timeout ?? 20_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timer.signal])
      : timer.signal;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.key) headers['Idempotency-Key'] = options.key;
    let body: BodyInit | undefined;
    if (options.bytes) {
      body = options.bytes;
      headers['Content-Type'] ??=
        options.bytes.type || 'application/octet-stream';
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    try {
      let response: Response;
      try {
        // Call the transport as a plain function: native fetch rejects a foreign `this`.
        const fetcher = this.fetcher;
        response = await fetcher(path + queryString(options.query), {
          method,
          headers,
          body,
          signal,
          credentials: 'same-origin',
          redirect: options.redirect ?? 'error',
        });
      } catch {
        if (options.signal?.aborted) throw new ApiError('cancelled', write);
        throw new ApiError(timer.signal.aborted ? 'timeout' : 'network', write);
      }
      if (response.ok) {
        return await consume(response, signal, timer.signal, write);
      }
      let problem: unknown = null;
      try {
        problem = parseJson(await readLimited(response, errorLimit, signal));
      } catch {
        // Non-JSON error pages never reach the user; the status decides the code.
      }
      const operation =
        typeof problem === 'object' &&
        problem !== null &&
        'operation_id' in problem &&
        typeof problem.operation_id === 'string' &&
        /^[a-f0-9]{64}$/.test(problem.operation_id)
          ? problem.operation_id
          : undefined;
      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        this.options.onUnavailable?.();
      }
      if (response.status === 401 || response.status === 403)
        this.options.onDenied?.(response.status);
      // A gateway or server failure without a recorded operation leaves a write's outcome unknown.
      throw new ApiError(
        serverCode(problem, response.status),
        write && response.status >= 500 && !operation,
        response.status,
        operation,
        problem,
        response.status === 429 ? response.headers.get('Retry-After') : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBody(
    response: Response,
    limit: number,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
    timedOut: AbortSignal,
    write: boolean,
  ) {
    try {
      return await readChunksLimited(response, limit, signal);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          error.code,
          error.uncertain || write,
          error.status ?? response.status,
          error.operationId,
        );
      }
      if (callerSignal?.aborted) {
        throw new ApiError('cancelled', write, response.status);
      }
      throw new ApiError(
        timedOut.aborted ? 'timeout' : 'network',
        write,
        response.status,
      );
    }
  }
}

/** Offer a downloaded file to the browser while keeping the original file name. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
