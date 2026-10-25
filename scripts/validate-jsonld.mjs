import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episodesDirectory = path.join(rootDirectory, "episodes");
const episodeFiles = (await readdir(episodesDirectory))
  .filter((fileName) => fileName.endsWith(".html"))
  .map((fileName) => path.join(episodesDirectory, fileName));
const htmlFiles = [path.join(rootDirectory, "index.html"), ...episodeFiles];
const errors = [];

function requireFields(data, fields, relativePath) {
  fields.forEach((field) => {
    if (!data[field]) errors.push(`${relativePath}: ${field} がありません。`);
  });
}

for (const htmlPath of htmlFiles) {
  const relativePath = path.relative(rootDirectory, htmlPath);
  const html = await readFile(htmlPath, "utf8");
  const blocks = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  if (blocks.length !== 1) {
    errors.push(`${relativePath}: JSON-LDは1ブロック必要です（検出: ${blocks.length}）。`);
    continue;
  }

  let data;

  try {
    data = JSON.parse(blocks[0][1]);
  } catch (error) {
    errors.push(`${relativePath}: JSON-LDの構文エラー: ${error.message}`);
    continue;
  }

  if (relativePath === "index.html") {
    if (data["@type"] !== "PodcastSeries") errors.push(`${relativePath}: @type が PodcastSeries ではありません。`);
    requireFields(data, ["name", "description", "url", "image", "inLanguage", "webFeed"], relativePath);
    continue;
  }

  if (data["@type"] !== "PodcastEpisode") errors.push(`${relativePath}: @type が PodcastEpisode ではありません。`);
  requireFields(data, ["name", "description", "datePublished", "timeRequired", "partOfSeries", "url"], relativePath);

  if (data.datePublished && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(data.datePublished)) {
    errors.push(`${relativePath}: datePublished がJST形式ではありません。`);
  }

  if (data.timeRequired && !/^PT(?=\d|[1-9])(?:\d+H)?(?:\d+M)?(?:\d+S)?$/.test(data.timeRequired)) {
    errors.push(`${relativePath}: timeRequired がISO 8601形式ではありません。`);
  }

  if (data.partOfSeries?.["@type"] !== "PodcastSeries") {
    errors.push(`${relativePath}: partOfSeries が PodcastSeries ではありません。`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${htmlFiles.length}件のHTMLでJSON-LDを検証しました。`);
}
