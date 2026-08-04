/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.tatacliq.com' },
      { protocol: 'https', hostname: '**.myntassets.com' },
      { protocol: 'https', hostname: '**.myntra.com' },
      { protocol: 'https', hostname: '**.ajio.com' },
      { protocol: 'https', hostname: 'assets.ajio.com' },
    ],
  },
};
module.exports = nextConfig;
