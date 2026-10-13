import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old tool addresses (links already shared) → the short ones.
  async redirects() {
    return [
      { source: "/bo-tach-dwg", destination: "/boc-tach", permanent: true },
      { source: "/kiem-tra-gdb", destination: "/kiem-tra", permanent: true },
    ];
  },
  turbopack: {
    resolveAlias: {
      // libredwg-web's WASM glue has a Node-only `await import("module")` branch; give the
      // browser/worker bundle a stub so it resolves (see src/shims/node-module.ts).
      module: { browser: "./src/shims/node-module.ts" },
    },
  },
};

export default nextConfig;
