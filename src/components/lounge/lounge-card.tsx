import { MapPin } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { localePath, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format, formatNumber, money } from "@/i18n/format";
import type { LoungeSummary } from "@/server/queries/lounges";
import { deviceTypeMeta } from "./device-type";

export function LoungeCard({ lounge, locale, dict }: { lounge: LoungeSummary; locale: Locale; dict: Dictionary }) {
  return (
    <Link
      href={localePath(locale, `/lounges/${lounge.slug}`)}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-primary/80 via-primary/50 to-sky-500/60">
        {lounge.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- lounge-hosted images from arbitrary domains
          <img src={lounge.coverImageUrl} alt="" className="size-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex size-full items-center justify-center gap-3 text-white/90">
            {lounge.types.slice(0, 4).map((t) => {
              const Icon = deviceTypeMeta[t].icon;
              return <Icon key={t} className="size-8" aria-hidden />;
            })}
          </div>
        )}
        {lounge.fromHourlyRate !== null && (
          <span className="absolute bottom-2 start-2 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold">
            {dict.common.from} {money(locale, lounge.fromHourlyRate, lounge.currency)}
            {dict.common.perHour}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-lg font-semibold leading-tight">{lounge.name}</h3>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {lounge.city} · {lounge.addressLine}
          </span>
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {lounge.types.map((t) => (
            <Badge key={t} variant="secondary">
              {dict.deviceType[t]}
            </Badge>
          ))}
          <span className="ms-auto text-xs text-muted-foreground">
            {format(dict.search.devicesCount, { count: formatNumber(locale, lounge.deviceCount) })}
          </span>
        </div>
      </div>
    </Link>
  );
}
