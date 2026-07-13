import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  // No Node builtins are used — the SDK targets any runtime with fetch/WebSocket.
  platform: "neutral",
});
