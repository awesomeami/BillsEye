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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
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
