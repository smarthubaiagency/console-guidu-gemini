/**
 * Messages too short to translate (TR2, traducao.md §4): "ok", "gracias",
 * an emoji, a number. Like the detection of the TR1, a short message
 * decides nothing and is shown as it came.
 */

const MIN_WORDS = 2;
const MIN_LETTERS = 6;

export function isShortMessage(text: string): boolean {
  const words = text.match(/\p{L}+/gu) ?? [];
  const letters = words.reduce((sum, word) => sum + word.length, 0);
  return words.length < MIN_WORDS || letters < MIN_LETTERS;
}
