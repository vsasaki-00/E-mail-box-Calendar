/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O worker e a UI compartilham o mesmo Prisma client; ele nao deve ser
  // empacotado pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
