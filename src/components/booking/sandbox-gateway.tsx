"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { completeSandboxPaymentAction } from "@/server/actions/booking";

export function SandboxGatewayActions({ transactionId }: { transactionId: string }) {
  const { dict, locale, href } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approved" | "declined" | null>(null);

  function settle(outcome: "approved" | "declined") {
    setChoice(outcome);
    startTransition(async () => {
      const res = await completeSandboxPaymentAction(locale, transactionId, outcome);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { result, reference } = res.data;
      if (result === "DECLINED") toast.error(dict.payment.declined);
      else if (result === "EXPIRED") toast.error(dict.payment.expired);
      else if (result === "ALREADY_PROCESSED") toast.info(dict.payment.alreadyProcessed);
      router.replace(href(`/bookings/${reference}`));
    });
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button size="lg" onClick={() => settle("approved")} disabled={pending}>
        {pending && choice === "approved" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        {dict.payment.approve}
      </Button>
      <Button size="lg" variant="outline" onClick={() => settle("declined")} disabled={pending}>
        {pending && choice === "declined" ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
        {dict.payment.decline}
      </Button>
    </div>
  );
}
