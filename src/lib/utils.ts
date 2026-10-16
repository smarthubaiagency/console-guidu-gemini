import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's font sizes (text-10 … text-48, globals.css) are sizes,
// not colours: without this, `cn("text-12", "text-text")` drops the size.
// The model-card radii and shadow (U4, ADR 0021) must replace the stock ones.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["10", "11", "12", "14", "16", "18", "20", "24", "30", "48"],
      radius: ["panel", "card", "inner", "control"],
      shadow: ["card"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
