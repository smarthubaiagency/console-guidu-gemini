import type { NotificationTransport } from "./types";

/**
 * Transport used while no e-mail provider is chosen (D-PA-08): renders are
 * still produced and tested, but nothing is delivered.
 */
export const disabledTransport: NotificationTransport = {
  async send() {
    return { status: "skipped", reason: "no_provider" };
  },
};

export function getNotificationTransport(): NotificationTransport {
  return disabledTransport;
}
