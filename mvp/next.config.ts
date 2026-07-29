import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep tracing inside mvp/ even though the monorepo root also has a lockfile.
  outputFileTracingRoot: path.join(__dirname),
  eslint: {
    // MVP is a greenfield package; don't inherit root eslint quirks.
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
