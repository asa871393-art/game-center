"use client";

import { CalendarCheck, MapPinned, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";

type Step = { title: string; body: string };

/** Smooth unless the visitor asked for reduced motion. */
function scrollToId(id: string) {
  const target = document.getElementById(id);
  if (!target) return null;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  return target;
}

const cardClass =
  "flex h-full w-full cursor-pointer gap-3 rounded-2xl border bg-card p-5 text-start transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0";

function CardBody({ index, icon: Icon, step }: { index: number; icon: LucideIcon; step: Step }) {
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{index}</span>
      <span>
        <span className="flex items-center gap-2 font-semibold">
          <Icon className="size-4" aria-hidden />
          {step.title}
        </span>
        <span className="block text-sm text-muted-foreground">{step.body}</span>
      </span>
    </>
  );
}

/**
 * The landing page's three steps as actions: search focuses the hero search, pick scrolls to the
 * lounges, book scrolls there too when signed in (booking starts from a lounge) or goes to sign-in.
 */
export function HowItWorks({
  steps,
  searchInputId,
  loungesSectionId,
  signInHref,
}: {
  steps: [Step, Step, Step];
  searchInputId: string;
  loungesSectionId: string;
  /** Set when the visitor is signed out: step 3 then links to sign-in. */
  signInHref?: string;
}) {
  const focusSearch = () => {
    const input = scrollToId(searchInputId);
    // preventScroll keeps the smooth scroll from being cut short by focus's jump.
    if (input instanceof HTMLElement) input.focus({ preventScroll: true });
  };
  const showLounges = () => scrollToId(loungesSectionId);

  return (
    <ol className="grid gap-4 sm:grid-cols-3">
      <li>
        <button type="button" onClick={focusSearch} className={cardClass}>
          <CardBody index={1} icon={Search} step={steps[0]} />
        </button>
      </li>
      <li>
        <button type="button" onClick={showLounges} className={cardClass}>
          <CardBody index={2} icon={MapPinned} step={steps[1]} />
        </button>
      </li>
      <li>
        {signInHref ? (
          <Link href={signInHref} className={cardClass}>
            <CardBody index={3} icon={CalendarCheck} step={steps[2]} />
          </Link>
        ) : (
          <button type="button" onClick={showLounges} className={cardClass}>
            <CardBody index={3} icon={CalendarCheck} step={steps[2]} />
          </button>
        )}
      </li>
    </ol>
  );
}
