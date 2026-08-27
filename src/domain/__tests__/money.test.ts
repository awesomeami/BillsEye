import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseMajorToMinor } from '../money';

describe('parseMajorToMinor', () => {
  test('returns null for null, undefined, empty', () => {
    assert.strictEqual(parseMajorToMinor(null), null);
    assert.strictEqual(parseMajorToMinor(undefined), null);
    assert.strictEqual(parseMajorToMinor(''), null);
    assert.strictEqual(parseMajorToMinor('   '), null);
  });

  test('parses integers correctly', () => {
    assert.strictEqual(parseMajorToMinor('1550'), 155000);
    assert.strictEqual(parseMajorToMinor('0'), 0);
  });

  test('parses with exactly two decimals', () => {
    assert.strictEqual(parseMajorToMinor('1550.00'), 155000);
    assert.strictEqual(parseMajorToMinor('1550.50'), 155050);
    assert.strictEqual(parseMajorToMinor('0.50'), 50);
  });

  test('parses with one decimal', () => {
    assert.strictEqual(parseMajorToMinor('1550.5'), 155050);
    assert.strictEqual(parseMajorToMinor('0.5'), 50);
  });

  test('parses comma separated thousands', () => {
    assert.strictEqual(parseMajorToMinor('1,550'), 155000);
    assert.strictEqual(parseMajorToMinor('1,550.50'), 155050);
    assert.strictEqual(parseMajorToMinor('1,234,567.89'), 123456789);
  });

  test('parses with allowed prefixes', () => {
    assert.strictEqual(parseMajorToMinor('Rs 1550'), 155000);
    assert.strictEqual(parseMajorToMinor('Rs. 1550'), 155000);
    assert.strictEqual(parseMajorToMinor('PKR 1550'), 155000);
    assert.strictEqual(parseMajorToMinor('Rs 1,550.50'), 155050);
  });

  test('parses with trailing /- suffix and whitespace', () => {
    assert.strictEqual(parseMajorToMinor('1,200/-'), 120000);
    assert.strictEqual(parseMajorToMinor('1550 /-'), 155000);
    assert.strictEqual(parseMajorToMinor('Rs. 1,200/-'), 120000);
    assert.strictEqual(parseMajorToMinor('PKR 1,550.50 /-'), 155050);
    assert.strictEqual(parseMajorToMinor('-1,200/-'), -120000);
    assert.strictEqual(parseMajorToMinor('(1,200/-)'), -120000);
  });

  test('parses negatives and refunds', () => {
    assert.strictEqual(parseMajorToMinor('-1550'), -155000);
    assert.strictEqual(parseMajorToMinor('(1550)'), -155000);
    assert.strictEqual(parseMajorToMinor('Rs -1550'), -155000);
    assert.strictEqual(parseMajorToMinor('-Rs 1550'), -155000);
  });

  test('rejects malformed commas', () => {
    assert.throws(() => parseMajorToMinor('1,55,0'), /Malformed monetary value/);
    assert.throws(() => parseMajorToMinor('1.550,50'), /Malformed monetary value/);
  });

  test('rejects too many decimals', () => {
    assert.throws(() => parseMajorToMinor('1550.505'), /Malformed monetary value/);
  });

  test('rejects huge values out of safe bounds', () => {
    // 9007199254740991 is max safe int
    assert.throws(() => parseMajorToMinor('90071992547409.92'), /exceeds safe integer bounds/);
  });
});
