import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "visuals/scoreboard": "src/visuals/scoreboard/index.ts",
        "components/team-badge": "src/components/team-badge/index.ts",
        "services/match-stats": "src/services/match-stats/index.ts",
        "connectors/twitch": "src/connectors/twitch/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
