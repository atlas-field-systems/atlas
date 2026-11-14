export const SHORT_ID_CAPACITY = 1_247_714;

export function encodeShortId(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > SHORT_ID_CAPACITY)
    throw new RangeError("short IDs exhausted");
  let n = seq - 1,
    length = 1;
  while (n >= 26 * 36 ** (length - 1)) {
    n -= 26 * 36 ** (length - 1);
    length++;
  }
  const power = 36 ** (length - 1);
  return (
    String.fromCharCode(65 + Math.floor(n / power)) +
    (length === 1
      ? ""
      : (n % power)
          .toString(36)
          .toUpperCase()
          .padStart(length - 1, "0"))
  );
}

export function decodeShortId(id: string): number | undefined {
  if (!/^[A-Z][A-Z0-9]{0,3}$/.test(id)) return undefined;
  let offset = 0;
  for (let l = 1; l < id.length; l++) offset += 26 * 36 ** (l - 1);
  return (
    offset +
    (id.charCodeAt(0) - 65) * 36 ** (id.length - 1) +
    (id.length > 1 ? parseInt(id.slice(1), 36) : 0) +
    1
  );
}

export type IdScope = "global" | "track" | "geofeature" | "object";
