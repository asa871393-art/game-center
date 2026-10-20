import { ForceDark } from "@/components/pos/force-dark";

/**
 * Cashier terminal shell: full screen, dark, touch-first; no customer header or footer.
 * Wrapping in `.dark` here makes the server-rendered HTML dark before hydration.
 */
export default function PosLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <div className="dark flex min-h-dvh flex-1 flex-col bg-background text-foreground [color-scheme:dark] select-none">
      <ForceDark />
      {children}
    </div>
  );
}
