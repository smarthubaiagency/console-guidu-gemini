"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { WorkbenchLayout, type WorkbenchPanelSize } from "./workbench-layout";

/**
 * Record page with its edit drawer driven by the URL (ADR 0015): the page
 * renders the list as `main` and, when the URL names a record
 * (`?edit=<id>` or `?edit=new`), its form as `panel`. Closing the drawer
 * goes to `closeHref`, the same list without the record, so every record
 * has its own address and a reload keeps the drawer open.
 */
export function RecordWorkbench({
  main,
  panel,
  panelLabel,
  closeHref,
  editKey,
  defaultPanelSize = "default",
}: Readonly<{
  main: React.ReactNode;
  /** Form of the record named in the URL; null when none is open. */
  panel: React.ReactNode | null;
  panelLabel: string;
  closeHref: string;
  /** The `edit` value of the URL; a new value reopens the drawer. */
  editKey: string | null;
  defaultPanelSize?: WorkbenchPanelSize;
}>) {
  const router = useRouter();
  // Closes at once while the navigation to `closeHref` is on its way.
  const [closing, setClosing] = useState(false);
  const [lastKey, setLastKey] = useState(editKey);
  if (editKey !== lastKey) {
    setLastKey(editKey);
    setClosing(false);
  }
  const open = panel != null && !closing;

  return (
    <WorkbenchLayout
      main={<div className="p-4 md:p-6">{main}</div>}
      panel={panel}
      panelLabel={panelLabel}
      panelOpen={open}
      defaultPanelSize={defaultPanelSize}
      onPanelOpenChange={(next) => {
        if (next) return;
        setClosing(true);
        router.push(closeHref, { scroll: false });
      }}
    />
  );
}
