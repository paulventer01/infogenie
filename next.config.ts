import type { NextConfig } from "next";

const EXPRESS = process.env.EXPRESS_PROXY_TARGET || "http://localhost:8000";
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://www.clarity.ms",
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
    ].join("; ");

    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
      {
        key: isProd ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
        value: csp,
      },
    ];
    if (isProd) {
      security.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
      security.push({ key: "X-Frame-Options", value: "SAMEORIGIN" });
    }

    return [
      {
        source: "/:path*",
        headers: security,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${EXPRESS}/api/:path*` },
      ],
      afterFiles: [],
      fallback: [
        { source: "/:path*", destination: `${EXPRESS}/:path*` },
      ],
    };
  },
};

export default nextConfig;
