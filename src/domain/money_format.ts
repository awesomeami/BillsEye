export function formatMinorToMajorStr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  const major = Math.floor(absValue / 100);
  const minor = absValue % 100;
  const str = `${major}.${minor.toString().padStart(2, '0')}`;
  return isNegative ? `-${str}` : str;
}
