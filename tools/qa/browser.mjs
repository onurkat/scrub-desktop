import { chromium } from "playwright-core";
import { readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export async function browser() {
  let executablePath = process.env.CHROME_BIN;
  const root = join(homedir(), ".cache/ms-playwright");
  if (!executablePath) {
    for (const dir of (await readdir(root))
      .filter((x) => x.startsWith("chromium-"))
      .reverse()) {
      for (const suffix of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = join(root, dir, suffix);
        try {
          await access(candidate);
          executablePath = candidate;
          break;
        } catch {
          /* Try another installed Chromium layout. */
        }
      }
      if (executablePath) break;
    }
  }
  if (!executablePath) throw Error("Set CHROME_BIN to a Chromium executable");
  return chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
}
export async function bridge(page) {
  await page.addInitScript(() => {
    window.qa = {
      clipboard: "a@example.com b@example.com",
      settings: {
        language: "en",
        skipReview: false,
        keepMappings: false,
        autostart: false,
        welcomed: true,
        scrubShortcut: "Ctrl+Alt+S",
        restoreShortcut: "Ctrl+Alt+R",
        dictionary: [],
        detectors: {},
      },
      store: { version: 1, current: null, recent: [] },
      notifications: [],
      hidden: false,
    };
    window.__TAURI__ = {
      core: {
        invoke: async (name, args = {}) => {
          const q = window.qa;
          switch (name) {
            case "bootstrap":
              return {
                settings: q.settings,
                mappings: q.store,
                version: "1.0.2",
                wayland: false,
              };
            case "frontend_ready":
              return [];
            case "menu_labels":
              q.menuLabels = args.labels;
              return;
            case "save_settings":
              return (q.settings = { ...q.settings, ...args.value });
            case "set_mappings":
              q.store = args.value;
              return;
            case "clear_mappings":
              q.store = { version: 1, current: null, recent: [] };
              return;
            case "read_clipboard":
              if (q.clipboardError) throw Error("clipboardEmpty");
              return q.clipboard;
            case "write_clipboard":
              q.clipboard = args.text;
              return;
            case "notify":
              q.notifications.push(args.message);
              return;
            case "hide_window":
              q.hidden = true;
              return;
            case "choose_file":
              return q.file || null;
            case "save_file":
              q.saved = args;
              return true;
            default:
              throw Error("Unhandled test bridge command " + name);
          }
        },
      },
      event: {
        listen: async (_, fn) => {
          window.qa.action = fn;
          return () => {};
        },
      },
    };
  });
}
