const { rssUrl: RSS_URL } = require("../site.config.json");

function decodeEntities(value = "") {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => entities[entity] || match);
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(block, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));

  return match ? decodeEntities(match[1]).trim() : "";
}

function getDescription(block) {
  return stripHtml(readTag(block, "itunes:summary") || readTag(block, "description"));
}

function parseEpisodes(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return itemBlocks.slice(0, 3).map((block) => ({
    title: stripHtml(readTag(block, "title")),
    pubDate: stripHtml(readTag(block, "pubDate")),
    duration: stripHtml(readTag(block, "itunes:duration")),
    description: getDescription(block),
    link: stripHtml(readTag(block, "link")),
  }));
}

async function resolveSpotifyEpisodeLink(episode) {
  const episodeId = episode.link.match(/-([a-z0-9]+)(?:[?#].*)?$/i)?.[1];

  if (!episodeId) return episode;

  try {
    const pageResponse = await fetch(episode.link, {
      headers: {
        "user-agent": "ningen-kokokusha-promo-site/1.0",
      },
    });

    if (!pageResponse.ok) return episode;

    const page = (await pageResponse.text())
      .replace(/\\u002F/g, "/")
      .replace(/\\u0026/g, "&");
    const escapedId = episodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spotifyMatch = page.match(
      new RegExp(`"episodeId":"${escapedId}"[\\s\\S]{0,6000}?"spotifyUrl":"(https://open\\.spotify\\.com/episode/[A-Za-z0-9]+)"`),
    );

    return spotifyMatch ? { ...episode, link: spotifyMatch[1] } : episode;
  } catch (error) {
    return episode;
  }
}

module.exports = async function handler(request, response) {
  try {
    const rssResponse = await fetch(RSS_URL, {
      headers: {
        "user-agent": "ningen-kokokusha-promo-site/1.0",
      },
    });

    if (!rssResponse.ok) {
      throw new Error(`RSS request failed: ${rssResponse.status}`);
    }

    const xml = await rssResponse.text();
    const episodes = await Promise.all(parseEpisodes(xml).map(resolveSpotifyEpisodeLink));

    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    response.status(200).json({ episodes });
  } catch (error) {
    response.status(502).json({
      episodes: [],
      message: "Failed to load episodes.",
    });
  }
};
