import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
export async function serve() {
  const root = resolve("ui");
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(
        root,
        "." + decodeURIComponent(req.url === "/" ? "/index.html" : req.url),
      );
      if (!path.startsWith(root + "/")) throw Error();
      res.setHeader(
        "Content-Type",
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          extname(path)
        ] || "application/octet-stream",
      );
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}
