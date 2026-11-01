import type { MetadataRoute } from "next";
import ar from "@/i18n/dictionaries/ar";

/** Web app manifest (/manifest.webmanifest). Arabic is the default locale, so the app installs in Arabic. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ar.meta.title,
    short_name: ar.common.appName,
    description: ar.meta.description,
    lang: "ar",
    dir: "rtl",
    start_url: "/ar",
    display: "standalone",
    // Al Asas brand: the POS runs dark, on near-black.
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
