import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanCommandOutput,
  stripEchoedLine,
} from '../plugins/huaweicloud-core/src/ws-exec/ws-exec-client.js';

test('stripEchoedLine removes a newline-terminated echoed command', () => {
  assert.equal(stripEchoedLine('cmd\nout', 'cmd'), 'out');
  assert.equal(stripEchoedLine('cmd\r\nout', 'cmd'), 'out');
  assert.equal(stripEchoedLine('out1\ncmd\nout2', 'cmd'), 'out1\nout2');
});

test('stripEchoedLine with allowAttached removes a trailing attached echo', () => {
  assert.equal(stripEchoedLine('outcmd', 'cmd', { allowAttached: true }), 'out');
  assert.equal(stripEchoedLine('cmd\n', 'cmd', { allowAttached: true }), '');
});

test('stripEchoedLine does not throw on a very long command (RangeError regression)', () => {
  const command = `echo '${'A'.repeat(128 * 1024)}' | base64 -d > /workspace/test.bin`;
  const output = `${command}\nsome output\n`;
  assert.doesNotThrow(() => stripEchoedLine(output, command));
  assert.equal(stripEchoedLine(output, command), 'some output\n');
});

test('cleanCommandOutput handles a long echoed command', () => {
  const command = `echo '${'A'.repeat(128 * 1024)}' | base64 -d > /workspace/test.bin`;
  const doneCommand = '__ws_exec_done__';
  const output = `${command}\nhello\n`;
  assert.equal(
    cleanCommandOutput(output, { inputEchoed: true, command, doneCommand }),
    'hello\n',
  );
});
