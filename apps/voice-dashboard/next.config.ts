import type { NextConfig } from "next";

const apiProxyTarget = process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.coziyoo.com";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@coziyoo/shared-types", "@coziyoo/shared-utils"],
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${apiProxyTarget}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
