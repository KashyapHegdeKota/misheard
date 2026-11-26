import type { NextConfig } from "next";

// Fully static site: every page is rendered at build time and the result is
// plain files in `out/` (no server code, no environment variables).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
