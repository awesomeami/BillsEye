import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { generateMerchantReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { getNextReportSort, ReportSortState, sortReportRows } from '../reportSorting';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

type MerchantSortField = 'merchant' | 'total' | 'visits' | 'averageBasket' | 'firstPurchase' | 'lastPurchase';

export function MerchantReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateMerchantReport(receipts, range), [receipts, range]);
  const [sort, setSort] = useState<ReportSortState<MerchantSortField> | null>(null);
  const sortedData = useMemo(() => sortReportRows(data, sort, (row, field) => row[field]), [data, sort]);
  const handleSort = (field: MerchantSortField, initialDirection: 'asc' | 'desc') => {
    setSort(current => getNextReportSort(current, field, initialDirection));
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p>No merchant data available for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="app-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <caption className="sr-only">Merchant spending summary</caption>
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <tr>
                <SortableTableHeader label="Merchant" active={sort?.field === 'merchant'} direction={sort?.direction ?? 'asc'} initialDirection="asc" onSort={() => handleSort('merchant', 'asc')} />
                <SortableTableHeader label="Total Spent" active={sort?.field === 'total'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('total', 'desc')} align="right" />
                <SortableTableHeader label="Visits" active={sort?.field === 'visits'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('visits', 'desc')} align="right" />
                <SortableTableHeader label="Average Basket" active={sort?.field === 'averageBasket'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('averageBasket', 'desc')} align="right" />
                <SortableTableHeader label="First Purchase" active={sort?.field === 'firstPurchase'} direction={sort?.direction ?? 'asc'} initialDirection="asc" onSort={() => handleSort('firstPurchase', 'asc')} />
                <SortableTableHeader label="Last Purchase" active={sort?.field === 'lastPurchase'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('lastPurchase', 'desc')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => (
                <tr key={row.merchant} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-blue-600">
                    <Link to={`/receipts?search=${encodeURIComponent(row.merchant)}`} className="hover:underline">
                      {row.merchant}
                    </Link>
                  </td>
                  <td className="money-value px-6 py-4 text-right">{formatCurrency(row.total / 100)}</td>
                  <td className="px-6 py-4 text-right">{row.visits}</td>
                  <td className="money-value px-6 py-4 text-right">{formatCurrency(row.averageBasket / 100)}</td>
                  <td className="px-6 py-4 text-gray-500">{row.firstPurchase || '-'}</td>
                  <td className="px-6 py-4 text-gray-500">{row.lastPurchase || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
