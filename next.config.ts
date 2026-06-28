import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project. Without a lockfile,
  // Next would otherwise walk up and mis-detect the home directory as the
  // root (because of a stray ~/node_modules), corrupting the RSC client
  // manifest with mixed module paths.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
