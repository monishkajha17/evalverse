import type { NextConfig } from "next";

/**
 * Keep `next build` and `next dev` on separate dist dirs.
 * Running `npm run build` while `next dev` is up used to wipe `.next`,
 * which 404'd CSS/JS chunks and made the landing page look broken.
 */
const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig: NextConfig = {
  output: "export",
  distDir,
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
