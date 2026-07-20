/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 允许较大的文件上传（Excel/CSV），app router 无内置 4MB 限制，这里仅作显式声明
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
  // 本项目未引入 ESLint 配置。Next 16 已移除 next.config 中的 eslint 选项，
  // 构建时不再自动跑 lint，类型检查仍开启（tsc）。
};

export default nextConfig;
