import { SiteHeader } from "@/components/site/site-header";

export default function ManagerLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col bg-muted/20">{children}</div>
    </>
  );
}
