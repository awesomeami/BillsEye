export function parseMajorToMinor(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  
  let cleaned = value.trim();

  // Strip trailing /- suffix if present (common in Pakistani receipts, e.g. "1,200/-")
  cleaned = cleaned.replace(/\s*\/-\s*$/, '').trim();
  
  // Strip prefix
  const prefixRegex = /^(?:PKR|Rs\.?)\s*/i;
  let isNegative = false;
  
  // Handle minus sign
  if (cleaned.startsWith('-')) {
    isNegative = true;
    cleaned = cleaned.substring(1).trim();
  } else if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true;
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  
  // Handle prefix after minus
  cleaned = cleaned.replace(prefixRegex, '');
  // Or minus after prefix
  if (!isNegative && cleaned.startsWith('-')) {
    isNegative = true;
    cleaned = cleaned.substring(1).trim();
  }

  // Strip trailing /- again if it was inside parentheses or after prefix
  cleaned = cleaned.replace(/\s*\/-\s*$/, '').trim();
  
  const strictRegex = /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;
  if (!strictRegex.test(cleaned)) {
    throw new Error(`Malformed monetary value: ${value}`);
  }
  
  const noCommas = cleaned.replace(/,/g, '');
  const parts = noCommas.split('.');
  const intPart = parts[0];
  let fracPart = parts[1] || '00';
  
  if (fracPart.length === 1) {
    fracPart += '0';
  }
  
  const minorStr = intPart + fracPart;
  const minorInt = parseInt(minorStr, 10);
  
  if (!Number.isSafeInteger(minorInt)) {
    throw new Error(`Monetary value exceeds safe integer bounds: ${value}`);
  }
  
  return isNegative ? -minorInt : minorInt;
}
