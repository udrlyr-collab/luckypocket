import type { NextConfig } from "next";

const config: NextConfig = { output: "standalone", reactStrictMode: true, experimental: { cpus: 1 } };
export default config;
