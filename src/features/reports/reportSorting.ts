export type SortDirection = 'asc' | 'desc';

export interface ReportSortState<Field extends string> {
  field: Field;
  direction: SortDirection;
}

export type SortableReportValue = string | number | null | undefined;

const reportCollator = new Intl.Collator('en-PK', {
  numeric: true,
  sensitivity: 'base',
});

export function getNextReportSort<Field extends string>(
  current: ReportSortState<Field> | null,
  field: Field,
  initialDirection: SortDirection,
): ReportSortState<Field> {
  if (current?.field !== field) return { field, direction: initialDirection };
  return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export function sortReportRows<Row, Field extends string>(
  rows: readonly Row[],
  sort: ReportSortState<Field> | null,
  getValue: (row: Row, field: Field) => SortableReportValue,
): Row[] {
  if (!sort) return [...rows];

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = getValue(left.row, sort.field);
      const rightValue = getValue(right.row, sort.field);
      const leftMissing = leftValue === null || leftValue === undefined;
      const rightMissing = rightValue === null || rightValue === undefined;

      // Missing metrics stay at the bottom in both directions.
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index;
        return leftMissing ? 1 : -1;
      }

      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : reportCollator.compare(String(leftValue), String(rightValue));

      return comparison === 0
        ? left.index - right.index
        : sort.direction === 'asc' ? comparison : -comparison;
    })
    .map(({ row }) => row);
}
