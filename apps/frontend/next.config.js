/** @type {import('next').NextConfig} */
const config = {
  async rewrites() {
    return [
      {
        source: '/api/checkout/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/checkout/:path*`,
      },
      {
        source: '/api/webhooks/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/webhooks/:path*`,
      },
    ];
  },
};

module.exports = config;
