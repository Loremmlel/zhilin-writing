import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext checks multipart uploads before dispatching Route Handlers.
    // Allow the 20 MiB attachment limit plus multipart overhead; business
    // validation still caps images at 10 MiB and attachments at 20 MiB.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
