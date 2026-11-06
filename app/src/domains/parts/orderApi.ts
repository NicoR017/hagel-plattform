// Parts orders (F3b): what the server sends and the little helpers of the screens. Orders are online (office) actions: nothing here is queued offline.
import { api } from "../../api";
import { t, type Key } from "../../shared/i18n";

export interface OrderLineView { id: string; n: number; partId: string; designation: string; zone: string; oem: string; qty: number; status: string | null; cancelled: boolean }
export interface OrderView {
  id: string; number: string; vehicleId: string; plate: string; model: string; claim: string; stationId: string | null; bodyShopId: string; bodyShop: string;
  kind: "main" | "complement" | "modification" | "cancellation"; reason: string | null; parentNumber: string | null; parentId: string | null;
  status: "draft" | "sending" | "sent" | "confirmed" | "delivered" | "send_failed" | "cancelled";
  requestedDate: string | null; announcedDate: string | null; sentAt: string | null; confirmedAt: string | null; createdAt: string;
  recipients: { to?: string[]; cc?: string[]; replyTo?: string | null }; lang: string; observations: string; lastError: string | null; attempts: number; createdBy: string; late: boolean; lines: OrderLineView[];
}
export interface CarOrdersData { orders: OrderView[]; ordering: { enabled: boolean; mode: string; hasRecipient: boolean; bodyShopId: string | null }; approval: { at: string | null; note: string | null } }
export interface OrderPreview { subject: string; text: string; to: string[]; cc: string[]; replyTo: string | null; requestedDate: string; lang: string; mode: string; parts: { id: string; name: string; qty: number }[]; pdf: string }

export const loadCarOrders = (vehicleId: string) => api<CarOrdersData>("GET", `/vehicles/${vehicleId}/orders`);
export const previewOrder = (vehicleId: string, body: Record<string, unknown>) => api<OrderPreview>("POST", `/vehicles/${vehicleId}/orders/preview`, body);
export const createOrderApi = (vehicleId: string, body: Record<string, unknown>) => api<{ id: string; number: string; status: string }>("POST", `/vehicles/${vehicleId}/orders`, body);
export const recordApproval = (vehicleId: string, body: { note?: string; sendOrderNow: boolean }) => api<{ approvedAt: string; order: { id: string; number: string; status: string } | null }>("POST", `/vehicles/${vehicleId}/approval`, body);
export const orderAction = (id: string, action: "send" | "resend" | "modify" | "cancel" | "confirm", body?: Record<string, unknown>) => api<unknown>("POST", `/parts/orders/${id}/${action}`, body ?? {});

export const statusText = (s: string) => t(`f4St_${s}` as Key);
export const kindText = (k: string) => t(`f4K_${k}` as Key);
/** "other: text" or a key of the reasons */
export const reasonText = (r: string | null) => (!r ? "" : r.startsWith("other: ") ? `${t("f4R_other")}: ${r.slice(7)}` : t(`f4R_${r}` as Key));
export const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "#EEF1F6", fg: "#46526A" }, sending: { bg: "#FDF0E1", fg: "#8A4A06" }, sent: { bg: "#E3ECFD", fg: "#1D4FB8" }, confirmed: { bg: "#E3F4EA", fg: "#17663F" },
  delivered: { bg: "#E3F4EA", fg: "#17663F" }, send_failed: { bg: "#FBE7E4", fg: "#9B2C1F" }, cancelled: { bg: "#EEF1F6", fg: "#8A93A5" },
};

/** open a PDF given as base64 in a new tab (the preview of an order) */
export function openPdfBase64(b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
