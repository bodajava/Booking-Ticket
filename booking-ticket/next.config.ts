import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Destination and hero photography. Pinned to one host so a compromised
    // or swapped URL elsewhere in the app cannot turn into an arbitrary
    // outbound image fetch.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;
