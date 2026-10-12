import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Item attachments are sent through server actions as data URLs.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
