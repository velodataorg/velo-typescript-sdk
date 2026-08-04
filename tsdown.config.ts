import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  // The Node-only `ws` adapter is dynamically loaded; other runtimes use
  // their native WebSocket, so the public bundle remains platform-neutral.
  platform: "neutral",
});
