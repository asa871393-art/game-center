"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { LoungeStatus } from "@/lib/db/types";
import { useI18n } from "@/i18n/client";
import { setLoungeStatusAction } from "@/server/actions/admin";

export function LoungeStatusToggle({ loungeId, name, status }: { loungeId: string; name: string; status: LoungeStatus }) {
  const { dict, locale, t } = useI18n();
  const [pending, start] = useTransition();
  if (status !== "ACTIVE" && status !== "SUSPENDED") return null;
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  const toggle = () => {
    if (next === "SUSPENDED" && !window.confirm(t(dict.admin.confirmSuspend, { name }))) return;
    start(async () => {
      const res = await setLoungeStatusAction({ locale, loungeId, status: next });
      if (!res.ok) toast.error(res.error);
      else toast.success(t(next === "SUSPENDED" ? dict.admin.suspended : dict.admin.activated, { name }));
    });
  };

  return (
    <Button size="sm" variant={next === "SUSPENDED" ? "outline" : "default"} onClick={toggle} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : next === "SUSPENDED" ? <Pause aria-hidden /> : <Play aria-hidden />}
      {next === "SUSPENDED" ? dict.admin.suspend : dict.admin.activate}
    </Button>
  );
}
