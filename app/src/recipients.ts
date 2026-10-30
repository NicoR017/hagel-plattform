export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 10;

export interface RecipientChip { email: string; source?: "bodyshop" | "insurer"; name?: string }

export type RecipientError = "bad" | "max" | null;

/**
 * Takes what was typed or pasted (`a@x.de; b@y.es`), adds every valid address (trimmed, lower-case, duplicates ignored silently)
 * and returns what could not be added: the invalid pieces stay in the field, the error says why.
 */
export function addRecipients(list: readonly RecipientChip[], text: string, max = MAX_RECIPIENTS): { list: RecipientChip[]; rest: string; error: RecipientError } {
  const out = [...list];
  const rest: string[] = [];
  let error: RecipientError = null;
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) { rest.push(raw.trim()); error = "bad"; continue; }
    if (out.some((x) => x.email === e)) continue;
    if (out.length >= max) { rest.push(raw.trim()); error ??= "max"; continue; }
    out.push({ email: e });
  }
  return { list: out, rest: rest.join(" "), error };
}

/** true when the text still holds a piece that is not an address */
export const hasInvalidPiece = (text: string): boolean => text.split(/[\s,;]+/).some((p) => p.trim() && !EMAIL_RE.test(p.trim().toLowerCase()));
