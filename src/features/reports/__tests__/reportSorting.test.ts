import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNextReportSort, sortReportRows } from '../reportSorting';

describe('reportSorting', () => {
  const rows = [
    { name: 'Item 10', amount: 100, change: null },
    { name: 'item 2', amount: 300, change: -5 },
    { name: 'Apple', amount: 200, change: 10 },
  ];

  it('sorts text naturally and numbers in either direction without mutating the source', () => {
    const source = [...rows];
    const byName = sortReportRows(rows, { field: 'name' as const, direction: 'asc' }, (row, field) => row[field]);
    const byAmount = sortReportRows(rows, { field: 'amount' as const, direction: 'desc' }, (row, field) => row[field]);

    assert.deepStrictEqual(byName.map(row => row.name), ['Apple', 'item 2', 'Item 10']);
    assert.deepStrictEqual(byAmount.map(row => row.amount), [300, 200, 100]);
    assert.deepStrictEqual(rows, source);
  });

  it('keeps unavailable values at the bottom in both directions', () => {
    const ascending = sortReportRows(rows, { field: 'change' as const, direction: 'asc' }, (row, field) => row[field]);
    const descending = sortReportRows(rows, { field: 'change' as const, direction: 'desc' }, (row, field) => row[field]);

    assert.deepStrictEqual(ascending.map(row => row.change), [-5, 10, null]);
    assert.deepStrictEqual(descending.map(row => row.change), [10, -5, null]);
  });

  it('uses the column default on first activation and toggles thereafter', () => {
    const initial = getNextReportSort(null, 'amount', 'desc');
    assert.deepStrictEqual(initial, { field: 'amount', direction: 'desc' });
    assert.deepStrictEqual(getNextReportSort(initial, 'amount', 'desc'), { field: 'amount', direction: 'asc' });
    assert.deepStrictEqual(getNextReportSort(initial, 'name', 'asc'), { field: 'name', direction: 'asc' });
  });
});
