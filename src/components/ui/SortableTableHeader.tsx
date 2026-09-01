import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { SortDirection } from '../../features/reports/reportSorting';
import { cn } from '../../utilities/cn';

interface SortableTableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  initialDirection: SortDirection;
  onSort: () => void;
  align?: 'left' | 'right';
  className?: string;
}

export function SortableTableHeader({
  label,
  active,
  direction,
  initialDirection,
  onSort,
  align = 'left',
  className,
}: SortableTableHeaderProps) {
  const nextDirection = active
    ? direction === 'asc' ? 'descending' : 'ascending'
    : initialDirection === 'asc' ? 'ascending' : 'descending';
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-4 py-2 font-medium sm:px-6', align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={`Sort by ${label}, ${active ? `currently ${direction === 'asc' ? 'ascending' : 'descending'}` : 'currently not sorted'}. Activate for ${nextDirection} order.`}
        className={cn(
          'touch-target inline-flex w-full items-center gap-1.5 rounded-md px-2 text-inherit hover:bg-gray-100 hover:text-gray-800',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" size={14} className={active ? 'text-blue-700' : 'text-gray-400'} />
      </button>
    </th>
  );
}
