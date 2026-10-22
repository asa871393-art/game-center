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
    background_color: "#ffffff",
    // --primary in globals.css (light theme).
    theme_color: "#7c3aed",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
