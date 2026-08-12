import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output: `next build` emits a self-contained server plus only the
   * node_modules it actually imports. It is what makes the Dockerfile's runtime
   * stage small, and it is inert for hosts that ignore it (Vercel), so it costs
   * nothing to leave on.
   */
  output: "standalone",
};

export default nextConfig;
