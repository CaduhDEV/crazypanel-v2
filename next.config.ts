import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev pelo túnel do Cloudflare (a uazapi precisa alcançar o webhook).
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app"],
  poweredByHeader: false,
  // Há um package-lock.json na pasta pai (github/): fixa a raiz neste projeto.
  turbopack: { root: __dirname },
};

export default nextConfig;
