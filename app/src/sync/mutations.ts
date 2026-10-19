import type { ClientVehicle, HeaderFields, Op, OrgSettings, PhotoPhase } from "@hagel/shared";
import { DEFAULT_ORG_SETTINGS } from "@hagel/shared";
import type { Settings } from "@hagel/calc";
import { ES_MATRIX_DEFAULT } from "@hagel/calc";
import { refsKey, type LocalDb, type LocalPhoto, type Refs } from "./db";
import type { SyncEngine } from "./engine";
import { uuid4 } from "./uuid";

export interface MutCtx { engine: SyncEngine; db: LocalDb; orgId: string; now?: () => Date }
const iso = (c: MutCtx) => (c.now ? c.now() : new Date()).toISOString();
const op = (c: MutCtx, type: string, f: Record<string, unknown>) => ({ opId: uuid4(), at: iso(c), type, ...f }) as unknown as Op;

export const calcSettingsOf = (s: OrgSettings | undefined): Settings => {
  const x = s ?? DEFAULT_ORG_SETTINGS;
  return { rateDE: x.rateDE, rateES: x.rateES, defaultTeiler: x.defaultTeiler, vatDE: 0.19, esMatrix: (x.esMatrix as Settings["esMatrix"]) ?? ES_MATRIX_DEFAULT };
};

export interface Prefs {
  land?: "DE" | "ES"; logo?: "pdr" | "none"; lastCompanyId?: string | null; lastClientStationId?: string | null; lastStationId?: string | null;
  techPct?: number; demTechPct?: number; defaultCommission?: number;
}
export const getPrefs = async (db: LocalDb): Promise<Prefs> => (await db.getMeta<Prefs>("prefs")) ?? {};
export const setPrefs = async (db: LocalDb, p: Partial<Prefs>) => db.setMeta("prefs", { ...(await getPrefs(db)), ...p });
export async function getRefs(db: LocalDb, orgId: string): Promise<Refs | undefined> { return db.getMeta<Refs>(refsKey(orgId)); }

const today = () => new Date().toISOString().slice(0, 10);

/** New vehicle with the defaults of the v20 app (last country, today, current rates, Trocken + Sauber …). */
export async function createVehicle(c: MutCtx, o: { stationId: string; clientStationId?: string | null; header?: HeaderFields; id?: string; statut?: "arrive" | "besichtigung" }): Promise<string> {
  const refs = await getRefs(c.db, c.orgId);
  const prefs = await getPrefs(c.db);
  const settings = refs?.settings ?? DEFAULT_ORG_SETTINGS;
  const station = refs?.stations.find((s) => s.id === o.stationId);
  const land = prefs.land ?? (station?.country === "ES" ? "ES" : "DE");
  const clientId = o.clientStationId !== undefined ? o.clientStationId : station?.type === "carrosserie" ? station.id : prefs.lastClientStationId ?? null;
  const client = refs?.stations.find((s) => s.id === clientId);
  const id = o.id ?? uuid4();
  const header: HeaderFields = {
    land, kennzeichen: "", fin: "", modell: "", kunde: client?.name ?? "", kundeEmail: "", leistungsdatum: today(),
    teiler: settings.defaultTeiler, stundensatz: land === "ES" ? settings.rateES : settings.rateDE, notiz: "",
    zustand: ["Trocken", "Sauber"], greifzone: false, hohlraum: false, verbringung: false, logo: prefs.logo ?? "pdr",
    // letterhead: the user's last choice, else the first one that has a logo (the default "PDR Team GmbH")
    ...(refs?.companies.length ? { companyId: prefs.lastCompanyId && refs.companies.some((x) => x.id === prefs.lastCompanyId) ? prefs.lastCompanyId : (refs.companies.find((x) => x.hasLogo) ?? refs.companies[0]).id } : {}),
    ...o.header,
  };
  await c.engine.enqueue(op(c, "vehicle.create", {
    vehicle: {
      id, stationId: o.stationId, clientStationId: clientId, campaignId: null, insurerId: null, header, panels: {},
      shares: { techName: "", techPct: prefs.techPct ?? 50, demTechName: "", demTechPct: prefs.demTechPct ?? 100 }, statut: o.statut ?? "arrive",
    },
  }), c.orgId);
  await setPrefs(c.db, { lastStationId: o.stationId, lastClientStationId: clientId });
  void c.engine.syncNow(c.orgId);
  return id;
}

const push = async (c: MutCtx, o: Op, vehicleId?: string) => { await c.engine.enqueue(o, c.orgId, vehicleId); void c.engine.syncNow(c.orgId); };

export const setHeader = (c: MutCtx, vehicleId: string, fields: HeaderFields) => push(c, op(c, "vehicle.header", { vehicleId, fields }));
export const setShares = (c: MutCtx, vehicleId: string, fields: Record<string, unknown>) => push(c, op(c, "vehicle.shares", { vehicleId, fields }));
export const setPanel = (c: MutCtx, vehicleId: string, key: string, panel: Record<string, unknown> | null) => push(c, op(c, "vehicle.panel", { vehicleId, key, panel }));
export const setStatus = (c: MutCtx, vehicleId: string, statut: string, motif?: string) => push(c, op(c, "vehicle.status", { vehicleId, statut, ...(motif ? { motif } : {}) }));
export const moveVehicle = (c: MutCtx, vehicleId: string, toStationId: string, note?: string) => push(c, op(c, "vehicle.move", { vehicleId, toStationId, ...(note ? { note } : {}) }));
export const deleteVehicle = (c: MutCtx, vehicleId: string) => push(c, op(c, "vehicle.delete", { vehicleId }));
export const assignVehicle = (c: MutCtx, vehicleId: string, kind: "pdr" | "demontage", userIds: string[]) => push(c, op(c, "vehicle.assign", { vehicleId, kind, userIds }));
export const setColibri = (c: MutCtx, vehicleId: string, colibri: Record<string, unknown>, file: { name: string; size: number } | null) =>
  push(c, op(c, "vehicle.colibri", { vehicleId, colibri, file }));

/** Photos taken while the vehicle is being repaired default to phase "reparatur", finished vehicles to "fertig". */
export const photoPhaseFor = (v: Pick<ClientVehicle, "statut">): PhotoPhase => (v.statut === "reparatur" ? "reparatur" : v.statut === "fertig" ? "fertig" : "besichtigung");

export async function addPhoto(c: MutCtx, o: {
  vehicleId: string; blob: Blob; label?: string; phase: PhotoPhase; source?: "app" | "colibri"; inPdf?: boolean; takenAt?: string;
  colibriPosition?: string | null; colibriIndex?: number | null; id?: string;
}): Promise<string> {
  const id = o.id ?? uuid4();
  const takenAt = o.takenAt ?? iso(c);
  const existing = await c.db.photos.where("vehicleId").equals(o.vehicleId).count();
  const row: LocalPhoto = {
    id, vehicleId: o.vehicleId, orgId: c.orgId, label: o.label ?? "Foto", phase: o.phase, source: o.source ?? "app", inPdf: o.inPdf ?? true, takenAt, takenBy: null,
    sort: existing, hasFile: false, colibriPosition: o.colibriPosition ?? null, colibriIndex: o.colibriIndex ?? null, deleted: false, seq: 0, _pending: true,
  };
  await c.db.transaction("rw", c.db.photos, c.db.blobs, c.db.uploads, async () => {
    await c.db.photos.put(row);
    await c.db.blobs.put({ key: `photo:${id}`, blob: o.blob, type: "image/jpeg", size: o.blob.size });
    await c.db.uploads.put({ key: `photo:${id}`, kind: "photo", refId: id, vehicleId: o.vehicleId, orgId: c.orgId, tries: 0, nextTry: 0 });
  });
  await push(c, op(c, "photo.add", {
    photo: { id, vehicleId: o.vehicleId, label: row.label, phase: row.phase, source: row.source, inPdf: row.inPdf, takenAt, sort: row.sort, colibriPosition: row.colibriPosition, colibriIndex: row.colibriIndex },
  }));
  return id;
}

export async function updatePhoto(c: MutCtx, photoId: string, fields: { label?: string; phase?: PhotoPhase; inPdf?: boolean; sort?: number }) {
  const p = await c.db.photos.get(photoId);
  if (!p) return;
  await c.db.photos.put({ ...p, ...fields });
  await push(c, op(c, "photo.update", { photoId, fields }), p.vehicleId);
}

export async function deletePhoto(c: MutCtx, photoId: string) {
  const p = await c.db.photos.get(photoId);
  if (!p) return;
  await c.db.photos.delete(photoId);
  await c.db.blobs.delete(`photo:${photoId}`);
  await c.db.uploads.delete(`photo:${photoId}`);
  await push(c, op(c, "photo.delete", { photoId }), p.vehicleId);
}

/**
 * Queue a report for e-mailing by the server. The PDF is built on the phone (works offline), stored locally and uploaded as soon as the
 * server has accepted the request; the server then sends it to the recipients it computes itself (carrosserie always, insurer by its rules).
 */
export async function sendReport(c: MutCtx, o: { vehicleId: string; type: "kva" | "reparation"; lang: "de" | "es"; pdf: Uint8Array; fileName: string }): Promise<string> {
  const id = uuid4();
  const key = `report:${id}`;
  await c.db.blobs.put({ key, blob: new Blob([o.pdf as BlobPart], { type: "application/pdf" }), type: "application/pdf", size: o.pdf.length, name: o.fileName });
  await c.db.uploads.put({ key, kind: "report", refId: id, vehicleId: o.vehicleId, orgId: c.orgId, tries: 0, nextTry: 0 });
  await push(c, op(c, "report.send", { vehicleId: o.vehicleId, report: { id, type: o.type, lang: o.lang } }));
  return id;
}
