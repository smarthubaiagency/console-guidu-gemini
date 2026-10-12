import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's font sizes (text-10 … text-48, globals.css) are sizes,
// not colours: without this, `cn("text-12", "text-text")` drops the size.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["10", "11", "12", "14", "16", "18", "20", "24", "30", "48"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
