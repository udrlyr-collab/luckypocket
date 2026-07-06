import "dotenv/config";
import path from "node:path";

const databaseValue = process.env.DATABASE_URL || "./data/lucky-pocket.db";

export const config = {
  port: Number(process.env.PORT || 3001),
  databasePath: path.resolve(
    process.cwd(),
    databaseValue.startsWith("file:") ? databaseValue.slice(5) : databaseValue,
  ),
  jwtSecret: process.env.JWT_SECRET || "local-development-secret-change-before-deploy",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY === "1",
};

if (config.isProduction && config.jwtSecret.length < 32) {
  throw new Error("Production JWT_SECRET must contain at least 32 characters.");
}
