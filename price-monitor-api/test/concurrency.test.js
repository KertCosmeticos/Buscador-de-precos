const test = require('node:test');
const assert = require('node:assert/strict');
const { mapWithConcurrency } = require('../src/utils/limit');

test('nunca ultrapassa cinco operações simultâneas', async () => {
  let active = 0;
  let maximum = 0;
  const input = Array.from({ length: 20 }, (_, index) => index);
  const result = await mapWithConcurrency(input, 5, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 5);
  assert.deepEqual(result, input.map((value) => value * 2));
});
