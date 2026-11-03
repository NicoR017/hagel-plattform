import { SYSTEM_ROLES } from "@hagel/shared";
import { t, tOr, type Key } from "../../shared/i18n";

export const scopeLabel = (s: string) => t(("scope" + s.charAt(0).toUpperCase() + s.slice(1)) as Key);
/** Default roles are shown translated; a role an admin renamed or created keeps its own name. */
export const isDefaultName = (key: string | null | undefined, name: string) => !!key && SYSTEM_ROLES.find((r) => r.key === key)?.name === name;
export const roleLabel = (key: string | null | undefined, name: string) => (isDefaultName(key, name) ? tOr("r." + key, name) : name);
export const roleDesc = (key: string | null | undefined, name: string, desc: string) => (isDefaultName(key, name) ? tOr("rd." + key, desc) : desc);
