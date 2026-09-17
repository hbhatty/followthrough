import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
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
