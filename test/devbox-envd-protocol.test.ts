import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  CONNECT_CONTENT_TYPE,
  ConnectFrameDecoder,
  assertConnectContentType,
  buildProcessStartRequest,
  decodeProcessChunk,
  deriveAppPortUrl,
  encodeConnectFrame,
  parseProcessEvent,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-envd-protocol.ts';
import { frame } from './devbox-test-helpers.ts';

test('encodeConnectFrame writes the 5-byte Connect envelope', () => {
  const encoded = Buffer.from(encodeConnectFrame({ process: { cmd: 'true' } }));
  assert.equal(encoded[0], 0, 'uncompressed/unary flag');
  assert.equal(encoded.readUInt32BE(1), Buffer.byteLength('{"process":{"cmd":"true"}}'));
  assert.equal(encoded.subarray(5).toString('utf8'), '{"process":{"cmd":"true"}}');
});

test('buildProcessStartRequest uses the non-PTY /bin/bash -l -c shape', () => {
  const body = buildProcessStartRequest('uname -a', { envs: { A: 'B' }, cwd: '/workspace/app' });
  assert.deepEqual(body, {
    process: {
      cmd: '/bin/bash',
      args: ['-l', '-c', 'uname -a'],
      envs: { A: 'B' },
      cwd: '/workspace/app',
    },
    stdin: false,
  });
  assert.throws(() => buildProcessStartRequest('   '), /command must not be blank/);
});

test('ConnectFrameDecoder parses split frames, output chunks, and the end trailer', () => {
  const decoder = new ConnectFrameDecoder();
  const stdout = Buffer.from('hello\n').toString('base64');
  const stderr = Buffer.from('warn\n').toString('base64');
  const stream = Buffer.concat([
    frame({ event: { start: { pid: 7 } } }),
    frame({ event: { data: { stdout } } }),
    frame({ event: { data: { stderr } } }),
    frame({ event: { end: { exitCode: 3 } } }),
    frame({}, 0x02),
  ]);

  // Split mid-header and mid-payload: the decoder must buffer without loss.
  const first = decoder.feed(stream.subarray(0, 3));
  assert.equal(first.events.length, 0);
  const second = decoder.feed(stream.subarray(3, 17));
  const third = decoder.feed(stream.subarray(17));
  const events = [...second.events, ...third.events];
  assert.equal(events.length, 4);
  assert.deepEqual(parseProcessEvent(events[0]!), { pid: 7 });
  assert.equal(parseProcessEvent(events[1]!).stdoutBase64, stdout);
  assert.equal(parseProcessEvent(events[2]!).stderrBase64, stderr);
  assert.equal(parseProcessEvent(events[3]!).exitCode, 3);
  assert.equal(third.ended, true);
  decoder.finish();
});

test('an end event without exitCode denotes success (EnvD omits it on exit 0)', () => {
  assert.equal(parseProcessEvent({ event: { end: { exited: true, status: 'exited' } } }).exitCode, 0);
  assert.equal(parseProcessEvent({ event: { end: { exitCode: 7, exited: true } } }).exitCode, 7);
});

test('decodeProcessChunk validates base64 and returns bytes', () => {
  assert.deepEqual(new Uint8Array(decodeProcessChunk('aGk=')!), new Uint8Array([104, 105]));
  assert.equal(decodeProcessChunk(undefined), undefined);
  assert.throws(() => decodeProcessChunk('not base64!!'), /invalid base64/);
});

test('an end-stream error is surfaced with its code and message', () => {
  const decoder = new ConnectFrameDecoder();
  const result = decoder.feed(frame({ error: { code: 'permission_denied', message: 'nope' } }, 0x02));
  assert.deepEqual(result.endError, { code: 'permission_denied', message: 'nope' });
  assert.equal(result.ended, true);
  decoder.finish();
});

test('truncated and untrailed streams are rejected', () => {
  const truncated = new ConnectFrameDecoder();
  truncated.feed(frame({ event: { start: { pid: 1 } } }).subarray(0, 6));
  assert.throws(() => truncated.finish(), /truncated Connect stream/);

  const untrailed = new ConnectFrameDecoder();
  untrailed.feed(frame({ event: { start: { pid: 1 } } }));
  assert.throws(() => untrailed.finish(), /without a trailer/);
});

test('compressed frames are rejected (v1 does not negotiate compression)', () => {
  const decoder = new ConnectFrameDecoder();
  assert.throws(() => decoder.feed(frame({}, 0x01)), /compressed Connect message/);
});

test('content type must be application/connect+json', () => {
  assert.equal(assertConnectContentType(`${CONNECT_CONTENT_TYPE}; charset=utf-8`), undefined);
  assert.throws(() => assertConnectContentType('application/json'), /invalid content type/);
});

test('deriveAppPortUrl swaps the EnvD API port for the app port', () => {
  assert.equal(
    deriveAppPortUrl('https://nyhfsfwt-49983.devbox-s2.hwtunnel.com/some/path?x=1', 8080),
    'https://nyhfsfwt-8080.devbox-s2.hwtunnel.com/',
  );
  assert.throws(() => deriveAppPortUrl('https://x-49983.example.com', 0), /invalid app port/);
});
