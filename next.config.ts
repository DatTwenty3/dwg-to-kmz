import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // libredwg-web's WASM glue has a Node-only `await import("module")` branch; give the
      // browser/worker bundle a stub so it resolves (see src/shims/node-module.ts).
      module: { browser: "./src/shims/node-module.ts" },
    },
  },
};

export default nextConfig;
