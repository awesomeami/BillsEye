import { DateRange, DateRangeFilter } from '../../domain/analytics';
import { cn } from '../../utilities/cn';

export interface DateRangeOption {
  value: DateRangeFilter;
  label: string;
}

interface DateRangeControlProps {
  id: string;
  label: string;
  value: DateRangeFilter;
  options: readonly DateRangeOption[];
  customRange: DateRange;
  onChange: (value: DateRangeFilter) => void;
  onCustomRangeChange: (range: DateRange) => void;
  className?: string;
  selectClassName?: string;
}

export function DateRangeControl({
  id,
  label,
  value,
  options,
  customRange,
  onChange,
  onCustomRangeChange,
  className,
  selectClassName,
}: DateRangeControlProps) {
  const hasInvalidOrder = Boolean(customRange.start && customRange.end && customRange.start > customRange.end);

  return (
    <div className={cn('space-y-2', value === 'custom' && 'sm:min-w-[22rem]', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as DateRangeFilter)}
        className={cn('form-control', selectClassName)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        <option value="custom">Custom Range</option>
      </select>

      {value === 'custom' ? (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">{label} custom dates</legend>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
            <input
              type="date"
              aria-label={`${label} start`}
              value={customRange.start ?? ''}
              max={customRange.end ?? undefined}
              aria-invalid={hasInvalidOrder}
              onChange={(event) => onCustomRangeChange({ ...customRange, start: event.target.value || null })}
              className="form-control"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
            <input
              type="date"
              aria-label={`${label} end`}
              value={customRange.end ?? ''}
              min={customRange.start ?? undefined}
              aria-invalid={hasInvalidOrder}
              onChange={(event) => onCustomRangeChange({ ...customRange, end: event.target.value || null })}
              className="form-control"
            />
          </label>
          {hasInvalidOrder ? <p className="col-span-2 text-xs text-red-700">The end date must be on or after the start date.</p> : null}
        </fieldset>
      ) : null}
    </div>
  );
}
