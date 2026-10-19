import type { Principal } from "./permissions";
export type Env = { Variables: { principal: Principal; sessionId: string; orgId: string } };
