import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleEpisodesRequest } from "./run-function.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vercelConfig = JSON.parse(await readFile(path.join(rootDirectory, "vercel.json"), "utf8"));
const port = Number(process.argv[2] || 4180);
const host = "127.0.0.1";

const contentTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

function compileRedirect({ source, destination, permanent }) {
  const parameterNames = [];
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = source
    .split("/")
    .map((part) => {
      let offset = 0;
      let compiled = "";
      for (const match of part.matchAll(/:([A-Za-z0-9_]+)/g)) {
        compiled += escapePattern(part.slice(offset, match.index));
        compiled += "([^/]+?)";
        parameterNames.push(match[1]);
        offset = match.index + match[0].length;
      }
      return compiled + escapePattern(part.slice(offset));
    })
    .join("/");
  const expression = new RegExp(`^${pattern}$`);

  return {
    match(pathname) {
      const match = pathname.match(expression);
      if (!match) return null;

      const values = Object.fromEntries(parameterNames.map((name, index) => [name, match[index + 1]]));
      return destination.replace(/:([A-Za-z0-9_]+)/g, (_, name) => values[name] ?? "");
    },
    statusCode: permanent ? 301 : 302,
  };
}

const redirects = (vercelConfig.redirects ?? []).map(compileRedirect);

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function safePath(pathname) {
  const filePath = path.resolve(rootDirectory, `.${pathname}`);
  return filePath === rootDirectory || filePath.startsWith(`${rootDirectory}${path.sep}`)
    ? filePath
    : null;
}

async function resolveStaticFile(pathname) {
  if (pathname === "/") return path.join(rootDirectory, "index.html");

  const directPath = safePath(pathname);
  if (!directPath) return null;
  if (path.extname(pathname) && await isFile(directPath)) return directPath;

  if (vercelConfig.cleanUrls === true && !path.extname(pathname)) {
    const htmlPath = `${directPath}.html`;
    if (await isFile(htmlPath)) return htmlPath;
  }

  const indexPath = path.join(directPath, "index.html");
  if (await isFile(indexPath)) return indexPath;
  return null;
}

function sendRedirect(response, location, statusCode = 301) {
  response.writeHead(statusCode, { location, "content-type": "text/plain; charset=utf-8" });
  response.end(`Redirecting to ${location}`);
}

async function sendFile(request, response, filePath, statusCode = 200) {
  const fileStat = await stat(filePath);
  response.writeHead(statusCode, {
    "content-type": contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "content-length": fileStat.size,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function sendNotFound(request, response) {
  const notFoundPath = path.join(rootDirectory, "404.html");
  if (await isFile(notFoundPath)) {
    await sendFile(request, response, notFoundPath, 404);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not Found");
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end("Method Not Allowed");
      return;
    }

    const requestUrl = new URL(request.url, `http://${host}:${port}`);
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      await sendNotFound(request, response);
      return;
    }

    if (pathname === "/api/episodes") {
      await handleEpisodesRequest(request, response);
      return;
    }

    for (const redirect of redirects) {
      const destination = redirect.match(pathname);
      if (destination) {
        sendRedirect(response, destination, redirect.statusCode);
        return;
      }
    }

    if (vercelConfig.cleanUrls === true && pathname.endsWith(".html")) {
      sendRedirect(response, pathname.slice(0, -5) || "/");
      return;
    }

    const filePath = await resolveStaticFile(pathname);
    if (filePath && await isFile(filePath)) {
      await sendFile(request, response, filePath);
      return;
    }

    await sendNotFound(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Production simulator: http://${host}:${port}`);
});
