import type { LocalDb, Refs } from "./db";

/**
 * Safety-net export in the OLD file format (compatible with the v20 app's "Sichern / Wiederherstellen"):
 * {app:"hes-hagel", version, created, vehicles[], customers[], settings{}, images{id: dataURL}, scans{vehicleId:{name,b64}}}.
 * It only contains what this user may see (the phone never holds anything else), and prices only if the server sent them.
 */
export async function buildOldFormatBackup(db: LocalDb, orgId: string, refs: Refs | undefined, withScans: boolean): Promise<{ json: string; vehicles: number; photos: number }> {
  const vs = await db.vehicles.where("orgId").equals(orgId).toArray();
  const photos = await db.photos.where("orgId").equals(orgId).toArray();
  const images: Record<string, string> = {};
  const scans: Record<string, { name: string; b64: string }> = {};
  const out: Record<string, unknown>[] = [];
  let nPhotos = 0;
  for (const v of vs) {
    const { statut, statutMotif: _m, statutDepuis: _sd, panelsAt: _pa, groupAt: _ga, assigneeIds: _as, orgId: _o, seq: _s, updatedBy: _ub, _pending, _localOnly, myShare: _ms, myCommission: _mc, ...rest } = v as Record<string, any>;
    void _pending; void _localOnly;
    const mine = photos.filter((p) => p.vehicleId === v.id).sort((a, b) => a.sort - b.sort);
    const imgs: { id: string; label: string }[] = [];
    for (const p of mine) {
      const b = await db.blobs.get(`photo:${p.id}`);
      if (!b) continue;
      images[p.id] = await blobToDataUrl(b.blob);
      imgs.push({ id: p.id, label: p.label });
      nPhotos++;
    }
    if (withScans && v.colibriFile) {
      const sc = await db.blobs.get(`scan:${v.id}`);
      if (sc) scans[v.id] = { name: (v.colibriFile as { name: string }).name, b64: await blobToBase64(sc.blob) };
    }
    out.push({
      ...rest,
      status: statut === "reparatur" ? "reparatur" : "besichtigung",
      kunde: rest.kunde ?? refs?.stations.find((s) => s.id === v.clientStationId)?.name ?? "",
      images: imgs,
      createdAt: Date.parse(String(rest.createdAt ?? v.updatedAt)) || Date.now(),
    });
  }
  const data = {
    app: "hes-hagel", version: "v2-export", created: new Date().toISOString(), vehicles: out,
    customers: (refs?.stations ?? []).filter((s) => s.type === "carrosserie").map((s) => ({ name: s.name, email: "" })),
    // rates only when this user may see prices (the server sends 0 otherwise)
    settings: { ...(refs && refs.settings.rateDE > 0 ? { stundensatz: refs.settings.rateDE, satzES: refs.settings.rateES } : {}), teiler: refs?.settings.defaultTeiler ?? 10 },
    images, scans,
  };
  return { json: JSON.stringify(data), vehicles: out.length, photos: nPhotos };
}

const blobToDataUrl = (b: Blob): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const blobToBase64 = async (b: Blob) => (await blobToDataUrl(b)).split(",")[1] ?? "";
