/** Offline fallback for plate / VIN recognition (ported from v20): text from Tesseract → regexes. */

export function findVIN(txt: string): string {
  const raw = String(txt).toUpperCase().replace(/\b(VIN|FIN|CHASSIS|CHASIS|BASTIDOR|FAHRGESTELLNUMMER|FAHRGESTELLNR|FGNR|NR|NO)\b\.?/g, " ");
  const cand: string[] = [];
  const fix = (s: string) => s.replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/Q/g, "0").replace(/I/g, "1");
  for (const line of raw.split(/[\r\n]+/)) {
    const re = /[A-HJ-NPR-Z0-9]{17}/g;
    const cl = fix(line);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cl))) cand.push(m[0]);
  }
  if (!cand.length) {
    const re = /[A-HJ-NPR-Z0-9]{17}/g;
    const all = fix(raw);
    let m: RegExpExecArray | null;
    while ((m = re.exec(all))) cand.push(m[0]);
  }
  cand.sort((a, b) => (/^[A-Z]{2,3}/.test(b) ? 1 : 0) - (/^[A-Z]{2,3}/.test(a) ? 1 : 0));
  return cand[0] ?? "";
}

export function findPlate(txt: string): string {
  const raw = String(txt).toUpperCase().replace(/[|]/g, "I");
  let m = /\b(\d{4})\s*[- ]?\s*([BCDFGHJKLMNPRSTVWXYZ]{3})\b/.exec(raw); // ES
  if (m) return `${m[1]} ${m[2]}`;
  m = /\b([A-ZÄÖÜ]{1,3})\s*[-·. ]\s*([A-Z]{1,2})\s*[ -]?\s*(\d{1,4})\b/.exec(raw); // DE
  if (m) return `${m[1]}-${m[2]} ${m[3]}`;
  return "";
}
