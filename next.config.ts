import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: the Docker image copies only the traced production
  // dependencies (.next/standalone) instead of the whole node_modules tree.
  output: "standalone",
};

export default nextConfig;
