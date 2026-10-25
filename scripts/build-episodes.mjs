import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(rootDirectory, "index.html");
const episodesDirectory = path.join(rootDirectory, "episodes");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const episodeListStart = "<!-- EPISODE_LIST_START -->";
const episodeListEnd = "<!-- EPISODE_LIST_END -->";
const seriesJsonLdStart = "<!-- PODCAST_SERIES_JSONLD_START -->";
const seriesJsonLdEnd = "<!-- PODCAST_SERIES_JSONLD_END -->";

function decodeEntities(value = "") {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  let decoded = value;

  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&([a-z]+);/gi, (match, entity) => namedEntities[entity.toLowerCase()] ?? match);
  }

  return decoded;
}

function readTag(block, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"))?.[1] ?? "";
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<\/?(?:p|div|li|h[1-6])(?:\s[^>]*)?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function episodeIdentifier(title, guid, link) {
  const episodeNumber = title.match(/#\s*(\d+)/)?.[1];

  if (episodeNumber) return episodeNumber;

  const stableSource = guid || link;
  const stableId = stableSource.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `archive-${stableId || "unknown"}`;
}

function formatDate(dateString) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return "配信日未設定";

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatDuration(duration = "") {
  const parts = duration.split(":").map(Number);

  if (parts.some(Number.isNaN)) return duration;

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  return [hours ? `${hours}時間` : "", minutes ? `${minutes}分` : "", seconds ? `${seconds}秒` : ""].filter(Boolean).join("");
}

function formatPublishedDate(dateString) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return "";

  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jstDate.toISOString().slice(0, 19)}+09:00`;
}

function formatIsoDuration(duration = "") {
  const parts = duration.split(":").map(Number);

  if (parts.some(Number.isNaN)) return "";

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  const value = [hours ? `${hours}H` : "", minutes ? `${minutes}M` : "", seconds ? `${seconds}S` : ""].filter(Boolean).join("");
  return `PT${value || "0S"}`;
}

function jsonLdMarkup(data) {
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

function parseEpisodes(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks.map((block) => {
    const title = stripHtml(readTag(block, "title"));
    const link = stripHtml(readTag(block, "link"));
    const guid = stripHtml(readTag(block, "guid"));
    const number = episodeIdentifier(title, guid, link);

    return {
      title,
      number,
      slug: `episode-${number}`,
      pubDate: stripHtml(readTag(block, "pubDate")),
      duration: stripHtml(readTag(block, "itunes:duration")),
      description: stripHtml(readTag(block, "description") || readTag(block, "itunes:summary")),
      spotifyUrl: link || config.spotifyShowUrl,
    };
  });
}

function descriptionMarkup(description) {
  const paragraphs = description.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("\n            ");
}

function summary(description, maximumLength = 155) {
  const oneLine = description.replace(/\s+/g, " ").trim();
  return oneLine.length > maximumLength ? `${oneLine.slice(0, maximumLength - 1).trim()}…` : oneLine;
}

function episodePage(episode, previousEpisode, nextEpisode) {
  const pageUrl = `${config.siteUrl}/episodes/${episode.slug}`;
  const imageUrl = `${config.siteUrl}/assets/og-cover.png`;
  const description = summary(episode.description);
  const publishedDate = new Date(episode.pubDate);
  const dateTime = Number.isNaN(publishedDate.getTime()) ? "" : publishedDate.toISOString();
  const episodeJsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: episode.title,
    description: episode.description,
    datePublished: formatPublishedDate(episode.pubDate),
    timeRequired: formatIsoDuration(episode.duration),
    partOfSeries: {
      "@type": "PodcastSeries",
      name: config.siteName,
      url: `${config.siteUrl}/`,
    },
    url: pageUrl,
  };
  const pagination = [
    previousEpisode
      ? `<a href="./${previousEpisode.slug}.html"><span>← 前の回</span><strong>${escapeHtml(previousEpisode.title)}</strong></a>`
      : "<span></span>",
    nextEpisode
      ? `<a href="./${nextEpisode.slug}.html"><span>次の回 →</span><strong>${escapeHtml(nextEpisode.title)}</strong></a>`
      : "<span></span>",
  ].join("\n          ");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(episode.title)} | ${escapeHtml(config.siteName)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#f2ead9" />
    <meta property="og:title" content="${escapeHtml(episode.title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:site_name" content="${escapeHtml(config.siteName)}" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(episode.title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${pageUrl}" />
    <script type="application/ld+json">
${jsonLdMarkup(episodeJsonLd).split("\n").map((line) => `      ${line}`).join("\n")}
    </script>
    <link rel="icon" type="image/png" href="../assets/tab.png" />
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body class="episode-page">
    <a class="skip-link" href="#main">本文へ移動</a>
    <header class="site-header" aria-label="サイトヘッダー">
      <a class="brand" href="../index.html" aria-label="ニンゲン広告社 トップ">
        <img src="../assets/ningen-kokokusha-wordmark-v4-red.png" alt="ニンゲン広告社" />
      </a>
    </header>
    <main id="main" class="episode-main">
      <a class="episode-back" href="../index.html#listen">← 最新エピソード一覧へ戻る</a>
      <article class="episode-article">
        <p class="episode-detail-meta"><time${dateTime ? ` datetime="${dateTime}"` : ""}>${escapeHtml(formatDate(episode.pubDate))}</time> / ${escapeHtml(formatDuration(episode.duration))}</p>
        <h1>${escapeHtml(episode.title)}</h1>
        <div class="episode-description">
            ${descriptionMarkup(episode.description)}
        </div>
        <a class="button primary episode-primary-action" href="${escapeHtml(episode.spotifyUrl)}" target="_blank" rel="noopener">Spotifyで聴く <span aria-hidden="true">↗</span></a>
        <nav class="episode-pagination" aria-label="前後のエピソード">
          ${pagination}
        </nav>
      </article>
    </main>
    <footer class="site-footer"><img src="../assets/ningen-kokokusha-wordmark-v4-white.png" alt="ニンゲン広告社" /><div><p>人文知でマーケティングを学ぶPodcast</p><a href="../index.html">サイトトップへ戻る</a></div><p class="copyright">© Ningen Agency 2026</p></footer>
  </body>
</html>
`;
}

function topEpisodeCard(episode) {
  const cardDescription = summary(episode.description, 120);
  return `<article class="episode-card">
  <p class="episode-meta">${escapeHtml(formatDate(episode.pubDate))} / ${escapeHtml(formatDuration(episode.duration))}</p>
  <h4>${escapeHtml(episode.title)}</h4>
  <p>${escapeHtml(cardDescription)}</p>
  <a href="./episodes/${episode.slug}.html">エピソードを開く</a>
</article>`;
}

function replaceEpisodeList(indexHtml, episodes) {
  const startIndex = indexHtml.indexOf(episodeListStart);
  const endIndex = indexHtml.indexOf(episodeListEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("index.html のエピソード生成マーカーが見つかりません。");
  }

  const cards = episodes.slice(0, 3).map(topEpisodeCard).join("\n");
  const replacement = `${episodeListStart}\n${cards || '<p class="episode-loading">最新エピソードを読み込めませんでした。Spotifyからご確認ください。</p>'}\n${episodeListEnd}`;
  return `${indexHtml.slice(0, startIndex)}${replacement}${indexHtml.slice(endIndex + episodeListEnd.length)}`;
}

function replacePodcastSeriesJsonLd(indexHtml) {
  const startIndex = indexHtml.indexOf(seriesJsonLdStart);
  const endIndex = indexHtml.indexOf(seriesJsonLdEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("index.html の構造化データ生成マーカーが見つかりません。");
  }

  const seriesJsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: config.siteName,
    description: "人文知でマーケティングを学ぶPodcast。人間の可笑しみから、使えるインサイトを掘り起こします。",
    url: `${config.siteUrl}/`,
    image: `${config.siteUrl}/assets/og-cover.png`,
    inLanguage: "ja",
    webFeed: config.rssUrl,
  };
  const indentedJson = jsonLdMarkup(seriesJsonLd).split("\n").map((line) => `      ${line}`).join("\n");
  const replacement = `${seriesJsonLdStart}\n    <script type="application/ld+json">\n${indentedJson}\n    </script>\n    ${seriesJsonLdEnd}`;
  return `${indexHtml.slice(0, startIndex)}${replacement}${indexHtml.slice(endIndex + seriesJsonLdEnd.length)}`;
}

function replaceSiteUrls(indexHtml) {
  const escapedSiteUrl = config.siteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return indexHtml
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/assets/og-cover.png$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/assets/og-cover.png$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${config.siteUrl}/$2`)
    .replace(new RegExp(`${escapedSiteUrl}/+`, "g"), `${config.siteUrl}/`);
}

async function fetchRss() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(config.rssUrl, {
      headers: { "user-agent": "ningen-kokokusha-promo-site/1.0" },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`RSS request failed: ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function build() {
  let episodes;

  try {
    episodes = parseEpisodes(await fetchRss());
    if (!episodes.length) throw new Error("RSSにエピソードがありません。");
  } catch (error) {
    console.warn(`RSS取得に失敗したため既存の生成物を保持します: ${error.message}`);
    return;
  }

  await rm(episodesDirectory, { recursive: true, force: true });
  await mkdir(episodesDirectory, { recursive: true });
  await Promise.all(episodes.map((episode, index) => writeFile(
    path.join(episodesDirectory, `${episode.slug}.html`),
    episodePage(episode, episodes[index + 1], episodes[index - 1]),
  )));

  const currentIndex = await readFile(indexPath, "utf8");
  await writeFile(indexPath, replacePodcastSeriesJsonLd(replaceSiteUrls(replaceEpisodeList(currentIndex, episodes))));
  console.log(`${episodes.length}件のエピソードページと最新3話を生成しました。`);
}

await build();
