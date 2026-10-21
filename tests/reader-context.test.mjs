import { readerContextContract } from './reader-context-contract.mjs';
import { contextFixture } from './reader-context-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
readerContextContract('SQLite', contextFixture);
test('Node reader operation signals abort only on premature request or response closure', async () => {
  const { nodeReaderSignal } = await import('../server/reader-context.js');
  const request = new EventEmitter(),
    response = new EventEmitter();
  const signal = nodeReaderSignal(request, response);
  response.writableFinished = true;
  response.emit('finish');
  response.emit('close');
  assert.equal(signal.aborted, false);
  assert.equal(request.listenerCount('aborted'), 0);
  const request2 = new EventEmitter(),
    response2 = new EventEmitter(),
    signal2 = nodeReaderSignal(request2, response2);
  response2.emit('close');
  assert.equal(signal2.aborted, true);
  const request3 = new EventEmitter(),
    response3 = new EventEmitter(),
    signal3 = nodeReaderSignal(request3, response3);
  request3.emit('aborted');
  assert.equal(signal3.aborted, true);
});
