import "server-only";

import { requireUser } from "@/core/auth/identity";
import { maintenanceStatus } from "@/core/maintenance/runtime";
import { prisma } from "@/lib/prisma/client";
import { getRedis } from "@/lib/redis/client";

import type { ApiDeps } from "./handler";
import { apiSwitches } from "./switch-runtime";

/** Dependencies of the API in the running app (F4a). */
export function apiDeps(): ApiDeps {
  return {
    prisma,
    redis: getRedis(),
    session: async () => {
      const identity = await requireUser();
      return { userId: identity.userId, mfaSatisfied: identity.mfaSatisfied };
    },
    maintenance: maintenanceStatus,
    apiSwitches,
  };
}
