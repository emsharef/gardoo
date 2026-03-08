import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  // TODO: Replace with your actual Trigger.dev project ref from https://cloud.trigger.dev
  project: "proj_placeholder",
  dirs: ["trigger"],
  build: {
    external: ["postgres"],
  },
});
