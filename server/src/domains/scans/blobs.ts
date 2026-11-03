export const SCANS_CONTAINER = "allscans";
export const PICTURES_CONTAINER = "scan-color-pictures";

const POSITIONS = [
  "FRONT_UPPER_RIGHT", "FRONT_BOTTOM_RIGHT", "RIGHT", "BACK_UPPER_RIGHT", "BACK_BOTTOM_RIGHT",
  "BACK_UPPER_LEFT", "BACK_BOTTOM_LEFT", "LEFT", "FRONT_UPPER_LEFT", "FRONT_BOTTOM_LEFT",
  "FRONT", "TOP_FRONT", "TOP_BACK", "EXTRA_LEFT", "EXTRA_RIGHT",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Blob name `<PartitionKey>_Overview_Pictures_<Position>-<n>` (position name or number; any extension). */
export function parsePhotoName(partitionKey: string, blobName: string, stems: string[] = []): { position: string; index: number } | null {
  const prefixes = [partitionKey, ...stems].map(escapeRe).join("|");
  const m = new RegExp(`^(?:${prefixes})_Overview_Pictures_([A-Za-z]+(?:_[A-Za-z]+)*|\\d+)(?:[-_](\\d+))?(?:\\.[A-Za-z0-9]+)?$`).exec(blobName);
  if (!m) return null;
  const raw = m[1];
  const position = /^\d+$/.test(raw) ? POSITIONS[Number(raw)] ?? `UNKNOWN_${raw}` : raw.toUpperCase();
  return { position, index: m[2] != null ? Number(m[2]) : 0 };
}

/** Stored labels stay German (documents translate them for Spanish). */
export function positionLabel(position: string): string {
  if (position === "EXTRA_LEFT" || position === "LEFT") return "Seite links";
  if (position === "EXTRA_RIGHT" || position === "RIGHT") return "Seite rechts";
  if (position.startsWith("FRONT")) return "Vorderansicht";
  if (position.startsWith("BACK")) return "Heckansicht";
  if (position.startsWith("TOP")) return "Dach";
  return "Sonstiges";
}

/** Report PDF blob names from the `urlPdf` column (full URL or bare name). */
export function pdfBlobName(urlPdf: string, partitionKey: string): string[] {
  const out: string[] = [];
  if (urlPdf) {
    try {
      const u = new URL(urlPdf);
      const parts = decodeURIComponent(u.pathname).replace(/^\//, "").split("/");
      out.push(parts[0] === SCANS_CONTAINER ? parts.slice(1).join("/") : parts.join("/"));
    } catch {
      out.push(urlPdf.replace(new RegExp(`^/?${SCANS_CONTAINER}/`), ""));
    }
  }
  out.push(`${partitionKey}.pdf`);
  return [...new Set(out.filter(Boolean))];
}

/** Photo blob-name prefixes: PDF stem and PartitionKey as yyyyMMdd-HHmm. */
export function photoStems(urlPdf: string, partitionKey: string): string[] {
  const out = pdfBlobName(urlPdf, partitionKey).map((n) => (n.split("/").pop() ?? n).replace(/\.pdf$/i, ""));
  const m = /^(\d{8})(\d{4})/.exec(partitionKey);
  if (m) out.push(`${m[1]}-${m[2]}`);
  return [...new Set(out.filter(Boolean))];
}

export { POSITIONS };
