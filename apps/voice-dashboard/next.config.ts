import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@coziyoo/shared-types", "@coziyoo/shared-utils"],
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: "http://localhost:3000/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
