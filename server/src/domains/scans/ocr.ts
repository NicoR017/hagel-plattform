/** Server-side proxy for plate / VIN recognition (Claude vision). The API key never leaves the server. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OcrResult { wert: string; sicher: "hoch" | "mittel" | "niedrig"; hinweis: string }

export function aiPrompt(mode: "kz" | "fin", land: "DE" | "ES"): string {
  if (mode === "fin") {
    return "Auf dem Foto ist die Fahrgestellnummer (FIN/VIN) eines Fahrzeugs zu sehen – entweder als Aufkleber, "
      + "als geprägte Plakette im Blech oder eingraviert unter der Windschutzscheibe.\n\n"
      + "Lies die FIN exakt ab. Regeln: genau 17 Zeichen, nur A-Z und 0-9. Die Buchstaben I, O und Q kommen in einer FIN "
      + "NIE vor – was danach aussieht, ist 1, 0 bzw. 0. Bei geprägtem Metall auf Schattenkanten achten. "
      + "Ignoriere Beschriftungen wie VIN, FIN, Fahrgestellnr., Bastidor, Typ, Baujahr.\n\n"
      + "Antworte NUR mit JSON, ohne Erklärung, ohne Markdown:\n"
      + '{"wert":"<17 Zeichen oder leer>","sicher":"hoch|mittel|niedrig","hinweis":"<kurz, falls unsicher>"}';
  }
  const fmt = land === "ES"
    ? "Spanisches Kennzeichen: vier Ziffern, Leerzeichen, drei Buchstaben (Beispiel: 1234 BCD). "
      + "Die Buchstaben schließen Vokale sowie Ñ und Q aus. Ältere Schilder können abweichen (z. B. B 1234 AB)."
    : "Deutsches Kennzeichen: Ortskennung (1-3 Buchstaben), Bindestrich, ein bis zwei Buchstaben, Leerzeichen, "
      + "ein bis vier Ziffern (Beispiel: KEL-LE 700). Plaketten und das blaue EU-Feld gehören nicht zum Kennzeichen.";
  return "Auf dem Foto ist ein Fahrzeug mit Nummernschild zu sehen. Lies das Kennzeichen exakt ab.\n\n" + fmt
    + "\n\nAntworte NUR mit JSON, ohne Erklärung, ohne Markdown:\n"
    + '{"wert":"<Kennzeichen oder leer>","sicher":"hoch|mittel|niedrig","hinweis":"<kurz, falls unsicher>"}';
}

export const cleanFin = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/Q/g, "0").replace(/I/g, "1");

export function parseOcrAnswer(text: string, mode: "kz" | "fin"): OcrResult {
  const t = text.replace(/```json|```/g, "").trim();
  let out: { wert?: unknown; sicher?: unknown; hinweis?: unknown };
  try { out = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); } catch { throw new Error("unreadable"); }
  let val = String(out.wert ?? "").toUpperCase().trim();
  if (mode === "fin") val = cleanFin(val);
  const sicher = out.sicher === "hoch" || out.sicher === "niedrig" ? out.sicher : "mittel";
  return { wert: val, sicher, hinweis: String(out.hinweis ?? "") };
}

export async function recognise(
  fetchFn: FetchLike, apiKey: string, model: string, imageB64: string, mode: "kz" | "fin", land: "DE" | "ES",
): Promise<OcrResult> {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 300,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
        { type: "text", text: aiPrompt(mode, land) },
      ] }],
    }),
  });
  const j = (await res.json().catch(() => null)) as { content?: { text?: string }[]; error?: unknown } | null;
  if (!res.ok || !j || j.error) throw new Error("provider");
  return parseOcrAnswer((j.content ?? []).map((c) => c.text ?? "").join(""), mode);
}
