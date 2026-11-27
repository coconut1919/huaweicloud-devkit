// Pure DevBox EnvD wire contract (no I/O, no network): the ConnectRPC JSON
// frame codec for one-shot Process/Start plus the URL/header derivations.
// Pinned by test/devbox-envd-protocol.test.ts against the SDK-generated wire
// shapes verified in devbox-temp/TEST-FINDINGS.md.

import { Buffer } from 'node:buffer';

export const ENVD_API_PORT = 49983;
export const PROCESS_START_PATH = '/process.Process/Start';
export const CONNECT_CONTENT_TYPE = 'application/connect+json';

const FLAG_END_STREAM = 0x02;
const FLAG_COMPRESSED = 0x01;

/** One Connect envelope: 1 flag byte + 4-byte big-endian length + JSON body. */
export function encodeConnectFrame(value: unknown): Uint8Array {
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(5 + data.length);
  frame.writeUInt8(0, 0);
  frame.writeUInt32BE(data.length, 1);
  data.copy(frame, 5);
  return frame;
}

export interface ProcessStartOptions {
  envs?: Record<string, string>;
  cwd?: string;
}

/** The exact body `Commands.run` sends: `/bin/bash -l -c <command>`, no PTY. */
export function buildProcessStartRequest(command: string, options: ProcessStartOptions = {}): Record<string, unknown> {
  if (!command || !command.trim()) {
    throw new Error('sandbox exec: command must not be blank.');
  }
  const processBody: Record<string, unknown> = {
    cmd: '/bin/bash',
    args: ['-l', '-c', command],
    envs: { ...(options.envs ?? {}) },
  };
  if (options.cwd) processBody.cwd = options.cwd;
  return { process: processBody, stdin: false };
}

export interface ProcessEvent {
  pid?: number;
  /** Base64 chunks: the client must decode with a streaming TextDecoder. */
  stdoutBase64?: string;
  stderrBase64?: string;
  exitCode?: number;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function decodeProcessChunk(base64: unknown): Uint8Array | undefined {
  if (typeof base64 !== 'string') return undefined;
  // Strict shape validation mirrors the SDK: junk must not decode as binary.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('DevBox EnvD returned invalid base64 process output.');
  }
  return Buffer.from(base64, 'base64');
}

export function parseProcessEvent(payload: Record<string, unknown>): ProcessEvent {
  const event = objectValue(payload.event);
  if (!event) return {};
  const out: ProcessEvent = {};
  const start = objectValue(event.start);
  if (start && typeof start.pid === 'number' && Number.isSafeInteger(start.pid) && start.pid > 0) {
    out.pid = start.pid;
  }
  const data = objectValue(event.data);
  if (data) {
    if (typeof data.stdout === 'string') out.stdoutBase64 = data.stdout;
    if (typeof data.stderr === 'string') out.stderrBase64 = data.stderr;
  }
  const end = objectValue(event.end);
  if (end) {
    // EnvD omits exitCode on success (the platform sends
    // {exited:true,status:"exited"}); the SDK's contract defaults it to 0.
    const raw = end.exitCode ?? end.exit_code ?? 0;
    const exitCode = Number(raw);
    if (Number.isFinite(exitCode)) out.exitCode = exitCode;
  }
  return out;
}

export interface ConnectEndError {
  code: string;
  message: string;
}

export interface ConnectChunkResult {
  events: Record<string, unknown>[];
  endError?: ConnectEndError;
  ended: boolean;
}

/**
 * Incremental Connect stream decoder. Returns complete message payloads;
 * the 0x02 end-stream frame carries an optional `{error:{code,message}}`.
 */
export class ConnectFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;

  feed(chunk: Uint8Array): ConnectChunkResult {
    if (this.ended && chunk.length > 0) {
      throw new Error('DevBox EnvD sent data after the Connect stream ended.');
    }
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const events: Record<string, unknown>[] = [];
    let endError: ConnectEndError | undefined;
    while (this.buffer.length >= 5) {
      const flags = this.buffer.readUInt8(0);
      const size = this.buffer.readUInt32BE(1);
      if (this.buffer.length < size + 5) break;
      const body = this.buffer.subarray(5, size + 5);
      this.buffer = this.buffer.subarray(size + 5);
      if ((flags & FLAG_COMPRESSED) !== 0) {
        throw new Error('DevBox EnvD returned a compressed Connect message (not supported).');
      }
      let payload: Record<string, unknown> = {};
      if (body.length > 0) {
        try {
          const parsed: unknown = JSON.parse(body.toString('utf8'));
          payload = objectValue(parsed) ?? {};
        } catch {
          throw new Error('DevBox EnvD returned invalid Connect JSON.');
        }
      }
      if ((flags & FLAG_END_STREAM) !== 0) {
        this.ended = true;
        const error = objectValue(payload.error);
        if (error) {
          endError = {
            code: typeof error.code === 'string' ? error.code : 'unknown',
            message: typeof error.message === 'string' ? error.message : 'EnvD request failed',
          };
        }
        if (this.buffer.length > 0) {
          throw new Error('DevBox EnvD sent data after the Connect stream ended.');
        }
        break;
      }
      events.push(payload);
    }
    return { events, endError, ended: this.ended };
  }

  finish(): void {
    if (this.buffer.length > 0) {
      throw new Error('DevBox EnvD returned a truncated Connect stream.');
    }
    if (!this.ended) {
      throw new Error('DevBox EnvD closed the Connect stream without a trailer.');
    }
  }
}

export function assertConnectContentType(contentType: string | null): void {
  const base = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  if (base !== CONNECT_CONTENT_TYPE) {
    throw new Error(`DevBox EnvD returned an invalid content type (${contentType ?? 'missing'}).`);
  }
}

/** EnvD host names embed the API port: `<tunnel>-49983.domain` -> `<tunnel>-<port>.domain`. */
export function deriveAppPortUrl(envdUrl: string, port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`sandbox preview: invalid app port ${port}.`);
  }
  const url = new URL(envdUrl);
  url.hostname = url.hostname.replace(/-49983(?=\.|$)/, `-${port}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}
