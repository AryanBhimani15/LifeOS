import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output, except on Vercel.
   *
   * `next build` normally emits a self-contained server plus only the
   * node_modules it actually imports, which is what keeps the Dockerfile's
   * runtime stage small — `COPY --from=build /app/.next/standalone` is the
   * whole point of that stage.
   *
   * This was previously unconditional, on the reasoning that a host which does
   * not use standalone output would simply ignore it. Vercel does not ignore
   * it: standalone mode relocates the file tracing output, and Vercel's
   * post-build step then fails looking for `.next/next-server.js.nft.json`.
   * The build compiles, type-checks and renders every page first, so it fails
   * at the last second with an ENOENT that names no code of ours.
   *
   * `VERCEL` is set on every Vercel build and by nothing else, so the container
   * path keeps the behaviour it depends on.
   */
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
