"use client";

import { Grid3x3, KeyRound, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/client";

export type SignInTab = "pin" | "password" | "google";

/**
 * Sign-in methods as tabs, quick PIN first. The panels are rendered by the page (server
 * components), so the PIN panel can show this terminal's staff or the set-up note.
 */
export function SignInTabs({
  defaultTab,
  pin,
  password,
  google,
}: {
  defaultTab: SignInTab;
  pin: ReactNode;
  password: ReactNode;
  google: ReactNode;
}) {
  const { dict } = useI18n();
  const l = dict.posLock;
  const trigger = "h-auto min-h-11 flex-col gap-1 whitespace-normal py-2 text-xs sm:text-sm";
  return (
    <Tabs defaultValue={defaultTab} className="gap-4">
      <TabsList aria-label={l.methods} className="grid h-auto w-full grid-cols-3">
        <TabsTrigger value="pin" className={trigger}>
          <Grid3x3 aria-hidden />
          {l.tabPin}
        </TabsTrigger>
        <TabsTrigger value="password" className={trigger}>
          <KeyRound aria-hidden />
          {l.tabPassword}
        </TabsTrigger>
        <TabsTrigger value="google" className={trigger}>
          <Mail aria-hidden />
          {l.tabGoogle}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pin">{pin}</TabsContent>
      <TabsContent value="password">{password}</TabsContent>
      <TabsContent value="google">{google}</TabsContent>
    </Tabs>
  );
}
