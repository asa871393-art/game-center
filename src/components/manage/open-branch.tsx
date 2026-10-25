import { redirect } from "next/navigation";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { getSession } from "@/server/session";
import { getManagedLounge } from "@/server/staff";

/** Redirects to `/manage/{branch}{section}`, or explains that this account has no access to the branch. */
export async function OpenBranch({ section }: { section: "" | "/staff" }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, `/manage${section}`));
  }
  const lounge = await getManagedLounge(session.user.id);
  if (lounge) redirect(localePath(locale, `/manage/${lounge.id}${section}`));
  const dict = await getDictionary(locale);
  return <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.noLounges}</p>;
}
