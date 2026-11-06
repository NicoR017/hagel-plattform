// Automatic translation of a catalogue part name into the other three languages. A PROPOSAL only: the admin validates or corrects it
// (the part stays flagged "not validated" until then). Provider: Azure AI Translator, configured by environment variables (never in the repo):
//   AZURE_TRANSLATOR_KEY (required), AZURE_TRANSLATOR_REGION (required for a regional resource), AZURE_TRANSLATOR_ENDPOINT (optional)
// Without a key there is no automatic translation (the admin types the four names).
import type { PartLang, PartNames } from "@hagel/shared";

export interface Translator { translate(text: string, from: PartLang): Promise<Partial<PartNames>> }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const LANGS: PartLang[] = ["de", "en", "fr", "es"];

export class AzureTranslator implements Translator {
  constructor(private o: { key: string; region?: string; endpoint?: string; fetch?: FetchLike }) {}
  async translate(text: string, from: PartLang): Promise<Partial<PartNames>> {
    const to = LANGS.filter((l) => l !== from);
    const url = `${(this.o.endpoint || "https://api.cognitive.microsofttranslator.com").replace(/\/$/, "")}/translate?api-version=3.0&from=${from}&${to.map((l) => `to=${l}`).join("&")}`;
    const headers: Record<string, string> = { "Ocp-Apim-Subscription-Key": this.o.key, "Content-Type": "application/json" };
    if (this.o.region) headers["Ocp-Apim-Subscription-Region"] = this.o.region;
    const f = this.o.fetch ?? ((u, i) => fetch(u, i) as never);
    const res = await f(url, { method: "POST", headers, body: JSON.stringify([{ Text: text }]) });
    if (!res.ok) throw new Error(`translator_${res.status}`);
    const data = (await res.json()) as { translations?: { to: string; text: string }[] }[];
    const out: Partial<PartNames> = {};
    for (const t of data[0]?.translations ?? []) if ((LANGS as string[]).includes(t.to)) out[t.to as PartLang] = String(t.text).slice(0, 120);
    return out;
  }
}

let override: Translator | null | undefined;
/** tests: force a translator (null = none) */
export const setTranslatorForTests = (t: Translator | null | undefined) => { override = t; };

export function getTranslator(): Translator | null {
  if (override !== undefined) return override;
  const key = process.env.AZURE_TRANSLATOR_KEY;
  if (!key) return null;
  return new AzureTranslator({ key, region: process.env.AZURE_TRANSLATOR_REGION, endpoint: process.env.AZURE_TRANSLATOR_ENDPOINT });
}
