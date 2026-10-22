import { Car, Crown, Gamepad2, Glasses, Monitor, Shapes, type LucideIcon } from "lucide-react";
import type { DeviceType } from "@/lib/db/types";

export const DEVICE_TYPES: readonly DeviceType[] = ["PC", "CONSOLE", "VR", "VIP_ROOM", "SIMULATOR", "OTHER"];

export const deviceTypeMeta: Record<DeviceType, { icon: LucideIcon; color: string }> = {
  PC: { icon: Monitor, color: "var(--device-pc)" },
  CONSOLE: { icon: Gamepad2, color: "var(--device-console)" },
  VR: { icon: Glasses, color: "var(--device-vr)" },
  VIP_ROOM: { icon: Crown, color: "var(--device-vip)" },
  SIMULATOR: { icon: Car, color: "var(--device-other)" },
  OTHER: { icon: Shapes, color: "var(--device-other)" },
};

export function isDeviceType(value: string | undefined): value is DeviceType {
  return !!value && (DEVICE_TYPES as readonly string[]).includes(value);
}
