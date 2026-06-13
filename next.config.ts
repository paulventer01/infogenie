import type { NextConfig } from "next";

// In dev, Next.js is the front door on the Replit webview port (5000) and the
// existing Express server runs on an internal port. Every request that Next
// does not own itself (the legacy SPA at `/`, all static assets, and the whole
// `/api/*` surface) is transparently proxied to Express so the browser only
// ever talks to a single origin — keeping the `infogenie.sid` session cookie
// same-origin and the existing app fully functional without any change.
//
// `EXPRESS_PROXY_TARGET` is set by `scripts/dev.js`; it defaults to the
// historical Express port so a bare `next dev` still works if Express is on
// 5000.
const EXPRESS = process.env.EXPRESS_PROXY_TARGET || "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // Run BEFORE Next's filesystem routing so the API surface can never be
      // shadowed by an accidental page route.
      beforeFiles: [
        { source: "/api/:path*", destination: `${EXPRESS}/api/:path*` },
      ],
      afterFiles: [],
      // Run only when nothing else matched (no Next page, no /_next asset, no
      // public file). This is what hands `/`, `/index.html`, `/style.css`,
      // `/app.js`, `/public/js/*`, `/manual/download`, etc. back to Express.
      fallback: [
        { source: "/:path*", destination: `${EXPRESS}/:path*` },
      ],
    };
  },
};

export default nextConfig;
