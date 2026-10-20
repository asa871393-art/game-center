import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";

export default async function NotFound() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-6xl font-extrabold text-primary">404</p>
      <h1 className="text-xl font-semibold">{dict.errors.notFound}</h1>
      <Link href={localePath(locale)} className={buttonVariants()}>
        {dict.nav.home}
      </Link>
    </main>
  );
}
