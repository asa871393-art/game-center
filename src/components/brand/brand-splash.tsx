import Image from "next/image";

/**
 * Full-screen Al Asas splash: the logo on the brand black with a green progress sweep.
 * Shown while a page loads (see app/[locale]/loading.tsx).
 */
export function BrandSplash({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-[#0a0a0a] px-6"
    >
      <Image
        src="/brand/logo-full-light.png"
        alt={label}
        width={896}
        height={460}
        priority
        className="h-auto w-60 max-w-[70vw] motion-safe:animate-[brand-breathe_1.8s_ease-in-out_infinite]"
      />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full w-1/3 rounded-full bg-[#86FD2A] motion-safe:animate-[brand-sweep_1.2s_ease-in-out_infinite]" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
