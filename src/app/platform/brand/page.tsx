import { redirect } from "next/navigation";

/** Marca moved to Configurações (CF2). */
export default function PlatformBrandRedirect() {
  redirect("/platform/settings/brand");
}
