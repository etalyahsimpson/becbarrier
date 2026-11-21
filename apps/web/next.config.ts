import type { NextConfig } from 'next';

/**
 * Web tier configuration. API calls are proxied same-origin through the
 * rewrite below, so session cookies never cross origins and no CORS surface
 * is needed. In compose, `API_UPSTREAM` points at the api service.
 */
const apiUrl = process.env.API_UPSTREAM ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
