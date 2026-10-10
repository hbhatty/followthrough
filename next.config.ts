import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingExcludes: {
    "*": [
      "./private-data/**/*",
      "./data/**/*",
      "./backups/**/*",
      "./.env*",
      "./**/*.db",
      "./**/*.db-*",
      "./**/*.sqlite*",
      "./**/xarchive*.json",
      "./**/xarchive*.csv",
      "./**/xarchive*.md",
    ],
  },
};

export default nextConfig;
