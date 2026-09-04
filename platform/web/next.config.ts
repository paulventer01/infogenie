import type { NextConfig } from "next";

// Single-origin front door (reference stack §3.3): the console and the API are
// served from one origin; API calls are proxied to the Express platform, so no
// CORS surface exists and session tokens never cross origins.
const API = process.env.PLATFORM_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/auth/:path*", destination: `${API}/auth/:path*` },
    ];
  },
};

export default nextConfig;
