import { openUrl } from "@tauri-apps/plugin-opener";

export async function openInBrowser(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}
