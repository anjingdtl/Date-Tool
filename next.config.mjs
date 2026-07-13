/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 允许较大的文件上传（Excel/CSV），app router 无内置 4MB 限制，这里仅作显式声明
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
  // 本项目未引入 ESLint 配置，构建时跳过 lint（类型检查仍开启）
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
