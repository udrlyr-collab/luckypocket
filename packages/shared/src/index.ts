import { z } from "zod";

export const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);
export const idempotencyKeySchema = z.string().uuid();

export const healthStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
});
