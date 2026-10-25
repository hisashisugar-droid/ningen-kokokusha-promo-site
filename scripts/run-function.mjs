import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const episodesHandler = require("../api/episodes.js");

export async function handleEpisodesRequest(request, response) {
  if (request.method !== "GET" || request.url !== "/api/episodes") {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }

  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (value) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
  };

  await episodesHandler(request, response);
}

export function createFunctionServer() {
  return createServer(handleEpisodesRequest);
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT || 4175);
  const server = createFunctionServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Function runner: http://127.0.0.1:${port}/api/episodes`);
  });
}
