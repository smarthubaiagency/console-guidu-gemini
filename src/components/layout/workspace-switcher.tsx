"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, Layers } from "lucide-react";
import type { UserWorkspace } from "@/core/workspaces/navigation";

interface WorkspaceSwitcherProps {
  currentSlug: string;
  workspaces: UserWorkspace[];
}

/**
 * Interactive workspace selector permitting fluid workspace switching
 * across authorized organizations without leaving the session.
 */
export function WorkspaceSwitcher({
  currentSlug,
  workspaces,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeWorkspace = workspaces.find(
    (w) => w.workspaceSlug === currentSlug,
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border-border bg-surface-card text-14 hover:bg-surface-hover focus:ring-focus-ring flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left font-medium shadow-xs transition focus:ring-2 focus:outline-none"
        aria-expanded={isOpen}
      >
        <div className="bg-primary text-on-primary flex h-6 w-6 items-center justify-center rounded-md">
          <Layers className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col text-left leading-tight">
          <span className="text-text font-semibold">
            {activeWorkspace?.workspaceName ?? currentSlug}
          </span>
          <span className="text-11 text-text-secondary">
            {activeWorkspace?.organizationName ?? "Organização"}
          </span>
        </div>
        <ChevronDown className="text-text-tertiary ml-1 h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div className="border-card-border bg-surface-card absolute left-0 z-50 mt-1.5 w-64 rounded-xl border p-1.5 shadow-lg">
          <div className="text-12 text-text-secondary px-2 py-1.5 font-semibold tracking-wider uppercase">
            Seus Workspaces
          </div>
          <div className="mt-1 space-y-0.5">
            {workspaces.map((ws) => {
              const isSelected = ws.workspaceSlug === currentSlug;
              return (
                <button
                  key={ws.workspaceId}
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    if (!isSelected) {
                      router.push(`/app/${ws.workspaceSlug}`);
                    }
                  }}
                  className={`text-12 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition ${
                    isSelected
                      ? "bg-surface-hover text-text font-medium"
                      : "text-text-subtle hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="text-text-tertiary h-3.5 w-3.5" />
                    <div>
                      <div className="text-text font-medium">
                        {ws.workspaceName}
                      </div>
                      <div className="text-11 text-text-secondary">
                        {ws.organizationName} • {ws.workspaceRole}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="text-text h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
