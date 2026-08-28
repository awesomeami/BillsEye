export type PdfSelectionRequest = {
  file: File;
  totalPages: number;
};

export type PdfSelectionPreparation = {
  selections: PdfSelectionRequest[];
  unreadableFiles: string[];
};

/** Reads every selected PDF before presenting one explicit page picker at a time. */
export async function preparePdfSelections(
  files: File[],
  getPageCount: (file: File) => Promise<number>,
): Promise<PdfSelectionPreparation> {
  const selections: PdfSelectionRequest[] = [];
  const unreadableFiles: string[] = [];

  for (const file of files) {
    try {
      selections.push({ file, totalPages: await getPageCount(file) });
    } catch {
      unreadableFiles.push(file.name);
    }
  }

  return { selections, unreadableFiles };
}
