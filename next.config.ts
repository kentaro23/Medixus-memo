import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native binaries (ffmpeg-static) as external packages so runtime paths are preserved on Vercel.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
