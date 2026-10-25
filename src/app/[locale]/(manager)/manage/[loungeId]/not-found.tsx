import { SearchX } from "lucide-react";
import { LoungeFallback } from "@/components/manage/lounge-fallback";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";

/** Shown for unknown lounge ids and for lounges the user can't access (same page, so ids can't be probed). */
export default async function LoungeNotFound() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <LoungeFallback
        icon={SearchX}
        title={dict.manage.loungeNotFound}
        hint={dict.manage.loungeNotFoundHint}
        actions={[
          { href: localePath(locale, "/manage"), label: dict.nav.manageLounge, primary: true },
          { href: localePath(locale, "/pos"), label: dict.nav.posTerminal },
        ]}
      />
    </main>
  );
}
