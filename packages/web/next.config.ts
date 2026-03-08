import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gardoo/server"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
