/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: isProd ? 'export' : undefined, // Check if we are in production

  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp: false,
      'onnxruntime-node': false,
    };

    config.module.rules.push({
      test: /\.node$/,
      type: 'asset/resource',
    });

    return config;
  },
};

// Headers needed for multi-threaded WASM in development
if (!isProd) {
  nextConfig.headers = async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  };
}

export default nextConfig;
