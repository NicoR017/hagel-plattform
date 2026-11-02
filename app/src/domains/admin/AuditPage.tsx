import { fmtDateTime, t, tOr } from "../../shared/i18n";
import { Card, Err, useLoad } from "./shared";

export function AuditPage() {
  const log = useLoad<{ id: string; at: string; action: string; entity: string; entityId: string | null; userId: string | null; before: unknown; after: unknown }[]>("/admin/audit?limit=200");
  return (
    <Card title={t("audit")}>
      <Err msg={log.err} />
      <table>
        <thead><tr><th>{t("time")}</th><th>{t("action")}</th><th>{t("object")}</th><th>{t("beforeAfter")}</th></tr></thead>
        <tbody>{log.data?.map((e) => (
          <tr key={e.id}><td>{fmtDateTime(e.at)}</td><td>{tOr("a." + e.action, e.action)}</td><td>{tOr("e." + e.entity, e.entity)}</td>
            <td style={{ fontSize: 12, wordBreak: "break-all" }}>{e.before ? JSON.stringify(e.before).slice(0, 160) : ""}{e.before && e.after ? " → " : ""}{e.after ? JSON.stringify(e.after).slice(0, 160) : ""}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}
