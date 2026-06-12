const RSS_URL = "https://anchor.fm/s/9bb1c5d8/podcast/rss";

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
    const episodes = parseEpisodes(xml);

    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    response.status(200).json({ episodes });
  } catch (error) {
    response.status(502).json({
      episodes: [],
      message: "Failed to load episodes.",
    });
  }
};
