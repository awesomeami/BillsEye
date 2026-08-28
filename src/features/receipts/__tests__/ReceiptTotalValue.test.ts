import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptDocument } from '../../../domain/schema';
import { ReceiptTotalValue } from '../../../components/receipts/ReceiptTotalValue';

function render(receipt: Pick<ReceiptDocument, 'items' | 'printedSubtotal' | 'printedDiscount' | 'printedTax' | 'printedFees' | 'printedRounding' | 'printedGrandTotal'>) {
  return renderToStaticMarkup(React.createElement(ReceiptTotalValue, { receipt }));
}

describe('ReceiptTotalValue', () => {
  test('renders an explicit unavailable state instead of a currency zero', () => {
    const markup = render({ items: [{ lineTotal: null } as ReceiptDocument['items'][number]] });

    assert.match(markup, /data-total-state="unavailable"/);
    assert.match(markup, /Unavailable/);
    assert.doesNotMatch(markup, /Rs\s*0/);
  });

  test('renders a known numeric zero as an available total', () => {
    const markup = render({ items: [], printedGrandTotal: 0 });

    assert.match(markup, /data-total-state="available"/);
    assert.doesNotMatch(markup, /Unavailable/);
  });

  test('uses the calculated fallback including fees and normalized discount', () => {
    const markup = render({
      items: [{ lineTotal: 1000 } as ReceiptDocument['items'][number]],
      printedDiscount: -100,
      printedFees: 20,
      printedTax: 50,
      printedRounding: -1,
    });

    assert.match(markup, /9\.69/);
  });
});
