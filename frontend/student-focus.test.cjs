const test = require('node:test');
const assert = require('node:assert/strict');
const { StudentFocus } = require('./student-focus.js');
test('late results from the previous student are invalidated', async () => {
  const focus = new StudentFocus(); focus.set('A'); const ticket = focus.ticket();
  await focus.change(async () => { focus.set('B'); assert.equal(focus.accepts(ticket), false); });
  assert.equal(focus.accepts(ticket), false); assert.equal(focus.accepts(focus.ticket()), true);
});
test('switching cannot discard an in-flight import and failed tasks release the busy state', async () => {
  const focus = new StudentFocus(); focus.set('A'); let finish;
  const task = focus.run(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(focus.change(async () => focus.set('B')), /尚未完成/);
  finish(); await task; assert.equal(focus.pending, 0);
  await assert.rejects(focus.run(async () => { throw new Error('failure'); }), /failure/);
  await focus.change(async () => focus.set('B')); assert.equal(focus.id, 'B');
});
