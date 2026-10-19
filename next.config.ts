import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev pelo túnel do Cloudflare (a uazapi precisa alcançar o webhook).
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app"],
  poweredByHeader: false,
  // Relatório em PDF gerado no servidor: usa o build de Node do jsPDF.
  serverExternalPackages: ["jspdf"],
  // Há um package-lock.json na pasta pai (github/): fixa a raiz neste projeto.
  turbopack: { root: __dirname },
};

export default nextConfig;
