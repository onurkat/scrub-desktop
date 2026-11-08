import { browser } from "./browser.mjs";
import { readFile, writeFile } from "node:fs/promises";
const b = await browser();
try {
  const page = await b.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  const brand = await readFile("src-tauri/icons/brand.svg", "utf8");
  async function render(svg, size, path) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`,
    );
    await page.screenshot({ path, omitBackground: true });
  }
  await render(brand, 1024, "src-tauri/icons/brand-1024.png");
  await render(brand, 64, "src-tauri/icons/64x64.png");
  for (const [theme, color] of [
    ["light", "#000000"],
    ["dark", "#ffffff"],
  ]) {
    const svg = brand
      .replace(/<rect[^>]+\/>/, "")
      .replace("#d6e89c", color)
      .replace('viewBox="0 0 64 64"', 'viewBox="8 8 48 48"');
    await writeFile(`src-tauri/icons/tray-${theme}.svg`, svg);
    for (const size of [16, 22, 32])
      await render(svg, size, `src-tauri/icons/tray-${theme}-${size}.png`);
    await render(svg, 32, `src-tauri/icons/tray-${theme}.png`);
  }
  await page.setViewportSize({ width: 900, height: 380 });
  const img = async (file, size) =>
    `<img width="${size}" height="${size}" src="data:image/png;base64,${(await readFile(file)).toString("base64")}">`;
  const rows = [];
  for (const theme of ["light", "dark"]) {
    let row = `<section class="${theme}"><h2>${theme} tray · 16 / 22 / 32 px</h2><div>`;
    for (const size of [16, 22, 32])
      row += await img(`src-tauri/icons/tray-${theme}-${size}.png`, size);
    rows.push(row + "</div></section>");
  }
  await page.setContent(
    `<style>body{font:16px system-ui;margin:24px;background:#eee}main{display:flex;gap:32px;align-items:center}section{padding:20px;border-radius:12px;width:340px}h2{font-size:16px}section div{display:flex;gap:32px;align-items:center;height:44px}.light{background:white;color:black}.dark{background:#202124;color:white}article{display:flex;gap:20px}</style><h1>Scrub 1.0.2 · brand assets</h1><main>${await img("src-tauri/icons/brand-1024.png", 128)}<p>1024 px source<br>Green #225a43<br>Lime #d6e89c</p></main><article>${rows.join("")}</article>`,
  );
  await page.screenshot({ path: "qa/screens/brand-icons.png" });
} finally {
  await b.close();
}
