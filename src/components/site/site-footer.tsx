import { format } from "@/i18n/format";
import { getDictionary } from "@/i18n/server";

export async function SiteFooter() {
  const dict = await getDictionary();
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>{format(dict.footer.rights, { year: "2026" })}</p>
        <p>{dict.footer.forLounges}</p>
      </div>
    </footer>
  );
}
