/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep API routes in /api directory
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
