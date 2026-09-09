import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@react-pdf/renderer", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/contexto": ["./node_modules/pdfjs-dist/legacy/build/*.mjs", "./node_modules/@napi-rs/canvas*/**/*"],
    "/api/contexto/worker": ["./node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
    "/api/sources/fiscal-pdf/*/suggestions": ["./node_modules/pdfjs-dist/legacy/build/*.mjs", "./node_modules/@napi-rs/canvas*/**/*"],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
