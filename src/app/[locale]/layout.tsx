import type { Metadata } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import { DirectionProvider } from "@/components/direction-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/client";
import { localeMeta, locales } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import "../globals.css";

// Cairo covers Arabic and Latin, so both locales share one typeface.
const cairo = Cairo({ variable: "--font-sans", subsets: ["arabic", "latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: { default: dict.meta.title, template: `%s · ${dict.meta.title}` },
    description: dict.meta.description,
    alternates: { languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])) },
  };
}

export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const { dir } = localeMeta[locale];

  return (
    <html lang={locale} dir={dir} className={`${cairo.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <I18nProvider locale={locale} dict={dict}>
          <DirectionProvider direction={dir}>
            <TooltipProvider>
              {children}
              <Toaster richColors position="top-center" dir={dir} />
            </TooltipProvider>
          </DirectionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
