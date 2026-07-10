/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
