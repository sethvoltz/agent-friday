import { loadConfig, CONFIG_PATH } from "@friday/shared";
import { existsSync } from "node:fs";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const configExists = existsSync(CONFIG_PATH);
  const config = loadConfig();

  return {
    configExists,
    configPath: CONFIG_PATH,
    config,
  };
};
