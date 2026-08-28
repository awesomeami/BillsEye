import assert from 'node:assert';
import { describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getErrorDiagnostic,
  GlobalErrorFallback,
  redactErrorDiagnostic,
} from '../../../components/ui/GlobalErrorBoundary';

describe('global error diagnostics', () => {
  test('production never exposes an error diagnostic', () => {
    const error = new Error('token=secret-token email person@example.com users/private-uid/receipts/private-doc');
    assert.strictEqual(getErrorDiagnostic(error, true), null);
    const markup = renderToStaticMarkup(React.createElement(GlobalErrorFallback, { error, production: true }));
    assert.match(markup, /Something went wrong/);
    assert.doesNotMatch(markup, /secret-token|person@example\.com|private-uid|private-doc/);
  });

  test('development diagnostics retain the error kind while redacting sensitive values', () => {
    const diagnostic = redactErrorDiagnostic(new TypeError(
      'Bearer abc.def.ghi person@example.com users/private-uid/receipts/private-doc apiKey=AIzaSecretValue123456789012345',
    ));
    assert.match(diagnostic, /^TypeError:/);
    assert.doesNotMatch(diagnostic, /person@example\.com|private-uid|private-doc|AIzaSecret|abc\.def\.ghi/);
    assert.match(diagnostic, /redacted/i);
  });
});
