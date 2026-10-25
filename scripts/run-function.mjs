import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const episodesHandler = require("../api/episodes.js");
const port = Number(process.env.PORT || 4175);

const server = createServer(async (request, response) => {
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
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Function runner: http://127.0.0.1:${port}/api/episodes`);
});
