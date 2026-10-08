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

  const activeWorkspace = workspaces.find((w) => w.workspaceSlug === currentSlug);

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
        className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-left text-sm font-medium shadow-xs transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        aria-expanded={isOpen}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-white">
          <Layers className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col text-left leading-tight">
          <span className="font-semibold text-neutral-900">
            {activeWorkspace?.workspaceName ?? currentSlug}
          </span>
          <span className="text-[11px] text-neutral-500">
            {activeWorkspace?.organizationName ?? "Organização"}
          </span>
        </div>
        <ChevronDown className="ml-1 h-3.5 w-3.5 text-neutral-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg z-50 animate-in fade-in-50 zoom-in-95">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
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
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    isSelected
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-neutral-400" />
                    <div>
                      <div className="font-medium text-neutral-900">
                        {ws.workspaceName}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {ws.organizationName} • {ws.workspaceRole}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-neutral-900" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
