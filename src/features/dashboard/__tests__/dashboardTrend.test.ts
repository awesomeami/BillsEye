import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  buildDailyTrendChartData,
  formatFullTrendDate,
  parseCalendarDate,
} from '../dashboardTrend';

describe('daily spending trend dates', () => {
  test('aggregates exact calendar dates and sorts a three-year dataset by full timestamp', () => {
    const data = buildDailyTrendChartData([
      { date: '2025-04-21', total: 500 },
      { date: '2022-01-10', total: 100 },
      { date: '2023-06-15', total: 300 },
      { date: '2022-01-10', total: 200 },
    ]);

    assert.deepStrictEqual(data.map(point => point.date), [
      '2022-01-10',
      '2023-06-15',
      '2025-04-21',
    ]);
    assert.deepStrictEqual(data.map(point => point.total), [300, 300, 500]);
    assert.ok(data[1].timestamp - data[0].timestamp < data[2].timestamp - data[1].timestamp);
    assert.match(formatFullTrendDate(data[2].timestamp), /2025/);
  });

  test('keeps one valid point usable and drops malformed or impossible dates', () => {
    const data = buildDailyTrendChartData([
      { date: '2024-02-29', total: 700 },
      { date: '2024-02-30', total: 100 },
      { date: '21 Apr 2025', total: 200 },
    ]);

    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].date, '2024-02-29');
    assert.strictEqual(parseCalendarDate('2024-02-30'), null);
  });
});
