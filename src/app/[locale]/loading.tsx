import { BrandSplash } from "@/components/brand/brand-splash";
import { getDictionary } from "@/i18n/server";

/** Every page under a locale shows the Al Asas splash until it is ready. */
export default async function Loading() {
  const dict = await getDictionary();
  return <BrandSplash label={dict.common.appName} />;
}
