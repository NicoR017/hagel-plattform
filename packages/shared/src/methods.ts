/** Calculation methods: validation of the parameters of each engine (the engines themselves live in @hagel/calc). */
import { z } from "zod";
import { esMatrixSchema } from "./sync";

const n = (min: number, max: number) => z.number().min(min).max(max);
const extras = z.object({ ruest: n(0, 100), greif: n(0, 100), finishPer: n(0, 100), finishCap: n(0, 200), hohl: n(0, 100), verbr: n(0, 100) });

export const awParamsSchema = z.object({
  vat: n(0, 1),
  aluFactor: n(1, 3),
  kleberFactor: n(1, 3),
  ptpFactor: n(0, 1),
  extras: z.object({ "10": extras, "12": extras }),
  kleberMaterial: z.object({ upTo2: n(0, 500), upTo5: n(0, 500), more: n(0, 500) }),
  hohlraumMaterial: n(0, 500),
}).strict();

export const matrixParamsSchema = z.object({ esMatrix: esMatrixSchema.nullable() }).strict();

export const methodParamsFor = (engine: "aw" | "matrix") => (engine === "aw" ? awParamsSchema : matrixParamsSchema);

export const methodInput = z.object({
  name: z.string().trim().min(1).max(120),
  engine: z.enum(["aw", "matrix"]),
  country: z.enum(["DE", "ES"]),
  params: z.unknown(),
  /** the method this one was copied from (informational) */
  base_method_id: z.string().uuid().nullable().default(null),
});
export const insurerMethodsInput = z.object({
  DE: z.string().uuid().nullable().default(null),
  ES: z.string().uuid().nullable().default(null),
});
