import { redirect } from "next/navigation";

export default function PartnerSettingsIndex() {
  redirect("/admin/settings/general");
}
