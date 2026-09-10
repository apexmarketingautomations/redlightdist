import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // White-label hosts are internally rewritten to /creator-site/[hostname].
    // These hard navigations must stay on the incoming creator domain.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  globalIgnores([".next/**", "coverage/**", "drizzle/meta/**"]),
]);
