/**
 * Money handling.
 *
 * Amounts are stored as integer minor units (cents). Binary floating point
 * cannot represent 0.10, so `0.1 + 0.2 !== 0.3`, and a sum of a few hundred
 * expenses drifts by real money. The database column is an Int with a
 * non-negative CHECK; direction lives in `kind` (EXPENSE/INCOME), not the sign.
 */

/** Currencies whose minor unit is not 1/100. */
const EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function minorUnitExponent(currency = "USD"): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Converts major units (12.34) to minor units (1234).
 *
 * Rounds rather than truncates: `Math.trunc(1.15 * 100)` is 114 because 1.15 is
 * stored as 1.14999…, which quietly loses a cent on roughly every eighth value.
 */
export function toMinorUnits(amount: number, currency = "USD"): number {
  const factor = 10 ** minorUnitExponent(currency);
  return Math.round(amount * factor);
}

export function toMajorUnits(minor: number, currency = "USD"): number {
  return minor / 10 ** minorUnitExponent(currency);
}

export function formatMoney(minor: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnitExponent(currency),
  }).format(toMajorUnits(minor, currency));
}

/** Sums minor units. Integer addition, so no drift regardless of length. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((total, n) => total + n, 0);
}
