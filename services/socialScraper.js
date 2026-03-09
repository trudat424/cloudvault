/**
 * Social Scraper Service
 * Extracts media from social platform URLs without requiring API keys.
 * Supports: YouTube, Instagram, TikTok, Twitter/X
 * Uses oEmbed endpoints, public APIs, and lightweight page scraping.
 */

const { queryOne } = require('../db/database');

// ── URL Detection ────────────────────────────────────

const URL_PATTERNS = {
  youtube:   /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  instagram: /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/,
  tiktok:    /tiktok\.com\/@[\w.-]+\/video\/(\d+)|vm\.tiktok\.com\/([\w]+)/,
  twitter:   /(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/,
};

/**
 * Detect platform and content ID from a URL
 * @param {string} url
 * @returns {{ platform: string, id: string, match: RegExpMatchArray } | null}
 */
function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim();

  for (const [platform, pattern] of Object.entries(URL_PATTERNS)) {
    const match = cleaned.match(pattern);
    if (match) {
      const id = platform === 'twitter' ? match[2] :
                 platform === 'tiktok'  ? (match[1] || match[2]) :
                 match[1];
      return { platform, id, match };
    }
  }
  return null;
}

// ── Cookie Loader ────────────────────────────────────

let igAccountIndex = 0; // Round-robin counter for Instagram multi-account

function getCookies(platform) {
  // Instagram multi-account pool: rotate through logged-in scraper accounts
  if (platform === 'instagram') {
    try {
      const accountsRow = queryOne('SELECT value FROM settings WHERE key = ?', ['scraper_accounts_instagram']);
      if (accountsRow && accountsRow.value) {
        const accounts = JSON.parse(accountsRow.value);
        if (Array.isArray(accounts) && accounts.length > 0) {
          const account = accounts[igAccountIndex % accounts.length];
          igAccountIndex++;
          if (account.cookies) return account.cookies;
        }
      }
    } catch (_) {}
  }

  // Fall back to single cookie string (all platforms, backward compat with manual paste)
  try {
    const row = queryOne('SELECT value FROM settings WHERE key = ?', [`scraper_cookies_${platform}`]);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

function buildHeaders(platform, extra = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };

  const cookies = getCookies(platform);
  if (cookies) {
    headers['Cookie'] = cookies;
  }

  return headers;
}

// ── YouTube Extractor ────────────────────────────────

async function extractYouTube(url, videoId) {
  try {
    const ytdl = require('@ybd-project/ytdl-core');
    const cookies = getCookies('youtube');

    const options = {};
    if (cookies) {
      options.requestOptions = {
        headers: { cookie: cookies },
      };
    }

    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, options);
    const details = info.videoDetails;

    return {
      id: videoId,
      title: details.title || 'YouTube Video',
      thumbnail: details.thumbnails?.length
        ? details.thumbnails[details.thumbnails.length - 1].url
        : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      date: details.publishDate || details.uploadDate || null,
      category: parseInt(details.lengthSeconds || '0') <= 60 ? 'short' : 'video',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      platform: 'youtube',
      duration: parseInt(details.lengthSeconds || '0'),
      author: details.author?.name || details.ownerChannelName || '',
      viewCount: parseInt(details.viewCount || '0'),
      hasVideo: true,
      extractionQuality: 'full',
    };
  } catch (err) {
    console.error('ytdl-core extraction failed:', err.message);
    return await extractYouTubeOEmbed(videoId);
  }
}

async function extractYouTubeOEmbed(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) throw new Error(`oEmbed returned ${res.status}`);
    const data = await res.json();

    return {
      id: videoId,
      title: data.title || 'YouTube Video',
      thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      date: null,
      category: 'video',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      platform: 'youtube',
      author: data.author_name || '',
      hasVideo: true,
      extractionQuality: 'good',
    };
  } catch (err) {
    return {
      id: videoId,
      title: 'YouTube Video',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      date: null,
      category: 'video',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      platform: 'youtube',
      hasVideo: true,
      extractionQuality: 'basic',
    };
  }
}

// ── Instagram Extractor ──────────────────────────────

async function extractInstagram(url, postId) {
  const hasCookies = !!getCookies('instagram');

  // Strategy 1: oEmbed (requires auth since 2024, may work with cookies)
  try {
    const oembedUrl = `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${postId}/&format=json`;
    const res = await fetch(oembedUrl, {
      headers: buildHeaders('instagram'),
      redirect: 'follow',
    });

    if (res.ok) {
      const data = await res.json();
      if (data.title || data.author_name || data.thumbnail_url) {
        return {
          id: postId,
          title: data.title || (data.author_name ? `${data.author_name}'s post` : 'Instagram Post'),
          thumbnail: data.thumbnail_url || null,
          date: null,
          category: url.includes('/reel') ? 'reel' : 'post',
          url: data.thumbnail_url || null,
          sourceUrl: `https://www.instagram.com/p/${postId}/`,
          platform: 'instagram',
          author: data.author_name || '',
          hasVideo: url.includes('/reel'),
          extractionQuality: 'good',
        };
      }
    }
  } catch (err) {
    console.error('Instagram oEmbed failed:', err.message);
  }

  // Strategy 2: API endpoint with cookies (requires admin cookies)
  if (hasCookies) {
    try {
      const headers = buildHeaders('instagram');
      const pageRes = await fetch(`https://www.instagram.com/p/${postId}/?__a=1&__d=dis`, { headers });

      if (pageRes.ok) {
        const text = await pageRes.text();
        try {
          const data = JSON.parse(text);
          const item = data.graphql?.shortcode_media || data.items?.[0];
          if (item) {
            return {
              id: postId,
              title: item.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 100) || item.caption?.text?.slice(0, 100) || 'Instagram Post',
              thumbnail: item.display_url || item.thumbnail_src || item.image_versions2?.candidates?.[0]?.url || null,
              date: item.taken_at_timestamp ? new Date(item.taken_at_timestamp * 1000).toISOString() : null,
              category: item.is_video ? 'reel' : 'post',
              url: item.video_url || item.display_url || item.image_versions2?.candidates?.[0]?.url || null,
              sourceUrl: `https://www.instagram.com/p/${postId}/`,
              platform: 'instagram',
              author: item.owner?.username || '',
              hasVideo: !!item.is_video,
              extractionQuality: 'full',
            };
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('Instagram API scrape failed:', err.message);
    }
  }

  // Strategy 3: Extract username from URL if possible
  const usernameMatch = url.match(/instagram\.com\/([^\/]+)\//);
  const username = (usernameMatch && !['p', 'reel', 'reels', 'tv', 'stories'].includes(usernameMatch[1]))
    ? usernameMatch[1] : '';

  // Return with limited data but useful metadata
  return {
    id: postId,
    title: username ? `@${username}'s post` : 'Instagram Post',
    thumbnail: null,
    date: null,
    category: url.includes('/reel') ? 'reel' : 'post',
    url: null,
    sourceUrl: `https://www.instagram.com/p/${postId}/`,
    platform: 'instagram',
    author: username || '',
    hasVideo: url.includes('/reel'),
    extractionQuality: 'limited',
    limitedReason: hasCookies
      ? 'Instagram blocked the request. Try updating your scraper cookies in Admin settings.'
      : 'Instagram requires authentication. Add scraper cookies in Admin settings for full previews.',
  };
}

// ── TikTok Extractor ─────────────────────────────────

async function extractTikTok(url, videoId) {
  // Strategy 1: oEmbed (most reliable)
  try {
    // Use the original URL directly for oEmbed - it's more reliable than constructing one
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const data = await res.json();
      if (data.title || data.thumbnail_url) {
        return {
          id: videoId,
          title: data.title || 'TikTok Video',
          thumbnail: data.thumbnail_url || null,
          date: null,
          category: 'video',
          url: data.thumbnail_url || null, // oEmbed doesn't expose direct video URL
          sourceUrl: url,
          platform: 'tiktok',
          author: data.author_name || data.author_unique_id || '',
          hasVideo: true,
          extractionQuality: 'good',
        };
      }
    }
  } catch (err) {
    console.error('TikTok oEmbed failed:', err.message);
  }

  // Strategy 2: Scrape page for embedded JSON data
  try {
    const headers = buildHeaders('tiktok');
    const pageRes = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const stateMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s) ||
                         html.match(/<script id="SIGI_STATE"[^>]*>(.*?)<\/script>/s);

      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          const itemModule = state.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ||
                            state.ItemModule?.[videoId];

          if (itemModule) {
            return {
              id: videoId,
              title: itemModule.desc || 'TikTok Video',
              thumbnail: itemModule.video?.cover || itemModule.video?.dynamicCover || null,
              date: itemModule.createTime ? new Date(itemModule.createTime * 1000).toISOString() : null,
              category: 'video',
              url: itemModule.video?.playAddr || itemModule.video?.downloadAddr || null,
              sourceUrl: url,
              platform: 'tiktok',
              author: itemModule.author?.uniqueId || itemModule.author?.nickname || '',
              hasVideo: true,
              extractionQuality: 'full',
            };
          }
        } catch (_) {}
      }

      // Try extracting og: meta tags from the HTML
      const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
      const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
      const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/);

      if (ogImage || ogTitle) {
        return {
          id: videoId,
          title: (ogTitle?.[1] || ogDesc?.[1] || 'TikTok Video').slice(0, 100),
          thumbnail: ogImage?.[1] || null,
          date: null,
          category: 'video',
          url: ogImage?.[1] || null,
          sourceUrl: url,
          platform: 'tiktok',
          author: '',
          hasVideo: true,
          extractionQuality: 'good',
        };
      }
    }
  } catch (err) {
    console.error('TikTok page scrape failed:', err.message);
  }

  return {
    id: videoId,
    title: 'TikTok Video',
    thumbnail: null,
    date: null,
    category: 'video',
    url: null,
    sourceUrl: url,
    platform: 'tiktok',
    hasVideo: true,
    extractionQuality: 'limited',
    limitedReason: 'Could not load preview. The video may be private or unavailable.',
  };
}

// ── Twitter/X Extractor ──────────────────────────────

async function extractTwitter(url, statusId) {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  const username = match ? match[1] : 'user';

  // Strategy 1: fxtwitter API (best quality, returns media URLs)
  try {
    const fxUrl = `https://api.fxtwitter.com/${username}/status/${statusId}`;
    const res = await fetch(fxUrl, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const data = await res.json();
      const tweet = data.tweet;

      if (tweet) {
        const media = tweet.media?.all || tweet.media?.photos || tweet.media?.videos || [];
        const firstMedia = media[0];

        return {
          id: statusId,
          title: tweet.text ? tweet.text.slice(0, 100) : 'Tweet',
          thumbnail: firstMedia?.thumbnail_url || firstMedia?.url || tweet.media?.photos?.[0]?.url || null,
          date: tweet.created_at ? new Date(tweet.created_at).toISOString() : null,
          category: 'tweet',
          url: firstMedia?.url || null,
          sourceUrl: `https://x.com/${username}/status/${statusId}`,
          platform: 'twitter',
          author: tweet.author?.name || tweet.author?.screen_name || username,
          hasVideo: !!(tweet.media?.videos?.length),
          mediaItems: media.map(m => ({
            url: m.url,
            thumbnail: m.thumbnail_url || m.url,
            type: m.type || 'photo',
          })),
          extractionQuality: 'full',
        };
      }
    }
  } catch (err) {
    console.error('fxtwitter API failed:', err.message);
  }

  // Strategy 2: vxtwitter API (alternative)
  try {
    const vxUrl = `https://api.vxtwitter.com/${username}/status/${statusId}`;
    const res = await fetch(vxUrl, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const text = await res.text();
      // vxtwitter sometimes returns HTML instead of JSON
      if (text.startsWith('{') || text.startsWith('[')) {
        const data = JSON.parse(text);
        if (data.text || data.user_name) {
          const mediaUrls = data.mediaURLs || data.media_extended?.map(m => m.url) || [];
          return {
            id: statusId,
            title: data.text ? data.text.slice(0, 100) : 'Tweet',
            thumbnail: mediaUrls[0] || null,
            date: data.date ? new Date(data.date).toISOString() : null,
            category: 'tweet',
            url: mediaUrls[0] || null,
            sourceUrl: `https://x.com/${username}/status/${statusId}`,
            platform: 'twitter',
            author: data.user_name || username,
            hasVideo: data.media_extended?.some(m => m.type === 'video') || false,
            mediaItems: (data.media_extended || []).map(m => ({
              url: m.url,
              thumbnail: m.thumbnail_url || m.url,
              type: m.type || 'photo',
            })),
            extractionQuality: 'full',
          };
        }
      }
    }
  } catch (err) {
    console.error('vxtwitter API failed:', err.message);
  }

  // Strategy 3: Twitter oEmbed (limited but reliable)
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const data = await res.json();
      // Extract tweet text from the HTML embed
      const textMatch = data.html?.match(/<p[^>]*>(.*?)<\/p>/s);
      const tweetText = textMatch?.[1]?.replace(/<[^>]+>/g, '')?.slice(0, 100) || '';

      return {
        id: statusId,
        title: tweetText || (data.author_name ? `${data.author_name}'s tweet` : 'Tweet'),
        thumbnail: null,
        date: null,
        category: 'tweet',
        url: null,
        sourceUrl: `https://x.com/${username}/status/${statusId}`,
        platform: 'twitter',
        author: data.author_name || '',
        hasVideo: false,
        extractionQuality: 'basic',
      };
    }
  } catch (err) {
    console.error('Twitter oEmbed failed:', err.message);
  }

  return {
    id: statusId,
    title: 'Tweet',
    thumbnail: null,
    date: null,
    category: 'tweet',
    url: null,
    sourceUrl: `https://x.com/${username}/status/${statusId}`,
    platform: 'twitter',
    hasVideo: false,
    extractionQuality: 'limited',
    limitedReason: 'Could not load tweet preview. The tweet may be private or deleted.',
  };
}

// ── Main Extract Function ────────────────────────────

async function extractFromUrl(url) {
  const detected = detectPlatform(url);
  if (!detected) {
    throw new Error('Unsupported URL. Supported platforms: YouTube, Instagram, TikTok, Twitter/X');
  }

  const { platform, id } = detected;

  switch (platform) {
    case 'youtube':   return extractYouTube(url, id);
    case 'instagram': return extractInstagram(url, id);
    case 'tiktok':    return extractTikTok(url, id);
    case 'twitter':   return extractTwitter(url, id);
    default:
      throw new Error(`Extractor not implemented for ${platform}`);
  }
}

// ── YouTube Download Stream ──────────────────────────

function downloadYouTubeStream(url) {
  const ytdl = require('@ybd-project/ytdl-core');
  const cookies = getCookies('youtube');

  const options = {
    quality: 'highest',
    filter: 'audioandvideo',
  };

  if (cookies) {
    options.requestOptions = {
      headers: { cookie: cookies },
    };
  }

  return ytdl(url, options);
}

// ── YouTube Search ───────────────────────────────────

async function searchYouTube(query, limit = 20) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) throw new Error(`YouTube search returned ${res.status}`);
    const html = await res.text();

    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) throw new Error('Could not parse YouTube search results');

    const data = JSON.parse(dataMatch[1]);
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!contents) return [];

    const items = [];
    for (const section of contents) {
      const renderers = section?.itemSectionRenderer?.contents || [];
      for (const renderer of renderers) {
        const video = renderer?.videoRenderer;
        if (!video || !video.videoId) continue;

        let duration = 0;
        const durText = video.lengthText?.simpleText;
        if (durText) {
          const parts = durText.split(':').map(Number);
          if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else duration = parts[0];
        }

        items.push({
          id: video.videoId,
          title: video.title?.runs?.map(r => r.text).join('') || 'YouTube Video',
          thumbnail: video.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
          date: video.publishedTimeText?.simpleText || null,
          category: duration <= 60 ? 'short' : 'video',
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          sourceUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
          platform: 'youtube',
          author: video.ownerText?.runs?.[0]?.text || '',
          duration,
          viewCount: parseInt(video.viewCountText?.simpleText?.replace(/[^0-9]/g, '') || '0'),
          hasVideo: true,
        });

        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }

    return items;
  } catch (err) {
    console.error('YouTube search failed:', err.message);
    return [];
  }
}

// ── Exports ──────────────────────────────────────────

module.exports = {
  detectPlatform,
  extractFromUrl,
  searchYouTube,
  downloadYouTubeStream,
  getCookies,
  URL_PATTERNS,
};
