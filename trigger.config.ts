import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_placeholder", // Will be updated with actual project ref
  dirs: ["trigger"],
  build: {
    external: ["postgres"],
  },
});
