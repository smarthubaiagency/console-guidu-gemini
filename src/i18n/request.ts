import { getRequestConfig } from "next-intl/server";

import { loadMessages, resolveRequestLocale } from "@/core/i18n/store";

/**
 * next-intl configuration (I1): no locale in the URL. The language of each
 * request is the person's, the workspace's, the browser's or the platform
 * default, and the texts include the edits of Plataforma › Idiomas.
 */
export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    // Display only; business dates keep the time zone of each location.
    timeZone: "America/Sao_Paulo",
  };
});
