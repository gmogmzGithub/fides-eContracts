/** @type {import('next').NextConfig} */
const nextConfig = {
  // Salida autocontenida para la imagen local de Docker.
  output: "standalone",
  serverExternalPackages: ["postgres", "pdf-lib", "qrcode"],
};

export default nextConfig;
