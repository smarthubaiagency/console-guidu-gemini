/**
 * Files the agent sends (A5d): where to download a Portfolio file and what
 * to call it. A Google Drive, Docs or Sheets sharing link opens a page, not
 * the file; it is turned into the file's download (a PDF for Docs and
 * Sheets). The file must be shared as "anyone with the link".
 */

/** Largest file sent to a channel (WhatsApp's documents go up to 100 MB). */
export const MAX_OUTBOUND_FILE_BYTES = 16_000_000;

const DRIVE_FILE = /^\/file\/d\/([\w-]{10,})/;
const GOOGLE_DOC = /^\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/;

/** The address that downloads the file itself. */
export function directFileUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname === "drive.google.com") {
    const id =
      DRIVE_FILE.exec(url.pathname)?.[1] ??
      (url.pathname === "/open" ? url.searchParams.get("id") : null);
    if (id) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    }
  }
  if (url.hostname === "docs.google.com") {
    const match = GOOGLE_DOC.exec(url.pathname);
    if (match) {
      return `https://docs.google.com/${match[1]}/d/${match[2]}/export?format=pdf`;
    }
  }
  return raw;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

/** A name for the file: the address's own, or the caption's, with its type. */
export function outboundFilename(
  url: string,
  caption: string | null,
  mediaType: string,
): string {
  const extension = EXTENSIONS[mediaType];
  let last = "";
  try {
    last = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
  } catch {
    last = "";
  }
  const own = /\.[a-z0-9]{2,5}$/i.test(last) ? last : null;
  const base = own ?? (caption?.trim() || "arquivo");
  const name =
    base
      .replace(/[^\w.\- ]+/g, "_")
      .trim()
      .slice(0, 80) || "arquivo";
  return own || !extension ? name : `${name}.${extension}`;
}

/** A downloaded page is not a file (a private or wrong link). */
export function isWebPage(mediaType: string | null): boolean {
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}
