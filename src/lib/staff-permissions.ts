import type { LoungeMemberRole } from "@/lib/db/types";

/** Who may edit a lounge member's details: owners anyone's, managers cashiers' and their own. */
export function canManageMember(actorRole: LoungeMemberRole, targetRole: LoungeMemberRole, isSelf: boolean): boolean {
  if (actorRole === "OWNER") return true;
  if (actorRole === "MANAGER") return isSelf || targetRole === "STAFF";
  return false;
}
