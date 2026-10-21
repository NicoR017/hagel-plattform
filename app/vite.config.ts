import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["pdr-team-logo.jpg", "pdr-logo-white.png", "apple-touch-icon.png"],
      manifest: {
        name: "PDR Hagel", short_name: "Hagel-Kalk", description: "Hagelschaden-Kalkulation – offline, mit Fotos",
        start_url: "/", scope: "/", display: "standalone", orientation: "portrait", background_color: "#16233f", theme_color: "#16233f",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // network-first for the app shell (so a new version arrives as soon as the phone is online), cache-first for hashed assets
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/api/"), handler: "NetworkFirst", options: { cacheName: "pages", networkTimeoutSeconds: 4 } },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } } },
  build: { outDir: "dist" },
});
