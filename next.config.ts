import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "archive.org" },
      { protocol: "https", hostname: "**.archive.org" }, // Open Library redirects here
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30, // keep resized covers for 30 days
  },
};

export default nextConfig;