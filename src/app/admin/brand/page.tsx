import { redirect } from "next/navigation";

/** Marca moved to Configurações (CF2). */
export default function PartnerBrandRedirect() {
  redirect("/admin/settings/brand");
}
