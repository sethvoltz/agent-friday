import type { Config } from "drizzle-kit";
import { join } from "node:path";
import { homedir } from "node:os";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: join(homedir(), ".friday", "friday.db"),
  },
} satisfies Config;
