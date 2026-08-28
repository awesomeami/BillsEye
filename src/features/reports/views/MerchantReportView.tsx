import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { generateMerchantReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

export function MerchantReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateMerchantReport(receipts, range), [receipts, range]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p>No merchant data available for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 md:hidden">
        {data.map((row) => <article key={row.merchant} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/receipts?search=${encodeURIComponent(row.merchant)}`} className="font-semibold text-blue-700 hover:underline">{row.merchant}</Link><p className="mt-1 text-xs text-gray-500">{row.visits} visit{row.visits === 1 ? '' : 's'} · Average {formatCurrency(row.averageBasket / 100)}</p></div><p className="shrink-0 text-lg font-bold text-gray-900">{formatCurrency(row.total / 100)}</p></div><p className="mt-3 text-xs text-gray-500">First purchase: {row.firstPurchase || '—'} · Last: {row.lastPurchase || '—'}</p></article>)}
      </div>
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Merchant spending summary</caption>
            <thead className="text-xs text-gray-500 bg-gray-50 uppercase border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-medium">Merchant</th>
                <th className="px-6 py-4 font-medium text-right">Total Spent</th>
                <th className="px-6 py-4 font-medium text-right">Visits</th>
                <th className="px-6 py-4 font-medium text-right">Average Basket</th>
                <th className="px-6 py-4 font-medium">First Purchase</th>
                <th className="px-6 py-4 font-medium">Last Purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row) => (
                <tr key={row.merchant} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-blue-600">
                    <Link to={`/receipts?search=${encodeURIComponent(row.merchant)}`} className="hover:underline">
                      {row.merchant}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-right">{formatCurrency(row.total / 100)}</td>
                  <td className="px-6 py-4 text-right">{row.visits}</td>
                  <td className="px-6 py-4 text-right">{formatCurrency(row.averageBasket / 100)}</td>
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
