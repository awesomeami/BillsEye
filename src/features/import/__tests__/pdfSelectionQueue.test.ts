import { describe, test } from 'node:test';
import assert from 'node:assert';
import { preparePdfSelections } from '../pdfSelectionQueue';

describe('preparePdfSelections', () => {
  test('retains every readable selected PDF and reports only explicit read failures', async () => {
    const first = new File(['one'], 'first.pdf', { type: 'application/pdf' });
    const unreadable = new File(['bad'], 'broken.pdf', { type: 'application/pdf' });
    const second = new File(['two'], 'second.pdf', { type: 'application/pdf' });

    const result = await preparePdfSelections([first, unreadable, second], async (file) => {
      if (file.name === 'broken.pdf') throw new Error('Unreadable');
      return file.name === 'first.pdf' ? 2 : 5;
    });

    assert.deepStrictEqual(result.selections.map(selection => [selection.file.name, selection.totalPages]), [
      ['first.pdf', 2],
      ['second.pdf', 5],
    ]);
    assert.deepStrictEqual(result.unreadableFiles, ['broken.pdf']);
  });
});
