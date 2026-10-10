import "server-only";

import { requireUser } from "@/core/auth/identity";
import { prisma } from "@/lib/prisma/client";
import { getRedis } from "@/lib/redis/client";

import type { ApiDeps } from "./handler";

/** Dependencies of the API in the running app (F4a). */
export function apiDeps(): ApiDeps {
  return {
    prisma,
    redis: getRedis(),
    session: async () => {
      const identity = await requireUser();
      return { userId: identity.userId, mfaSatisfied: identity.mfaSatisfied };
    },
  };
}
