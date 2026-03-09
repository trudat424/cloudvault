const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { queryAll, queryOne, run } = require('../db/database');
const config = require('../config');
const scraper = require('../services/socialScraper');
const s3Storage = require('../services/s3Storage');

function getAccountId(req) {
  return req.headers['x-account-id'] || req.query.account_id || null;
}

// Platform configuration
const PLATFORMS = {
  instagram: {
    name: 'Instagram',
    icon: 'instagram',
    description: 'Import photos, reels, and stories',
    categories: ['post', 'reel', 'story'],
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scope: 'user_profile,user_media',
    clientId: () => config.INSTAGRAM_CLIENT_ID,
    clientSecret: () => config.INSTAGRAM_CLIENT_SECRET,
  },
  tiktok: {
    name: 'TikTok',
    icon: 'tiktok',
    description: 'Import your TikTok videos',
    categories: ['video'],
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'user.info.basic,video.list',
    clientId: () => config.TIKTOK_CLIENT_KEY,
    clientSecret: () => config.TIKTOK_CLIENT_SECRET,
  },
  twitter: {
    name: 'Twitter / X',
    icon: 'twitter',
    description: 'Import media from your tweets',
    categories: ['tweet'],
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scope: 'tweet.read users.read offline.access',
    clientId: () => config.TWITTER_CLIENT_ID,
    clientSecret: () => config.TWITTER_CLIENT_SECRET,
  },
  youtube: {
    name: 'YouTube',
    icon: 'youtube',
    description: 'Import your videos and shorts',
    categories: ['video', 'short'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    clientId: () => config.GOOGLE_CLIENT_ID,
    clientSecret: () => config.GOOGLE_CLIENT_SECRET,
  },
};

// GET /api/social/platforms - list all platforms and their connection status
router.get('/platforms', (req, res) => {
  const accountId = getAccountId(req);
  const connections = accountId
    ? queryAll('SELECT * FROM social_connections WHERE account_id = ?', [accountId])
    : [];

  const platforms = Object.entries(PLATFORMS).map(([key, platform]) => {
    const conn = connections.find(c => c.platform === key);
    const hasCredentials = !!(platform.clientId() && platform.clientSecret());
    return {
      id: key,
      name: platform.name,
      icon: platform.icon,
      description: platform.description,
      categories: platform.categories,
      connected: !!conn,
      username: conn ? conn.platform_username : null,
      connectedAt: conn ? conn.connected_at : null,
      available: hasCredentials,
      urlImportAvailable: true,
      scrapeBrowseAvailable: key === 'youtube',
    };
  });

  res.json(platforms);
});

// GET /api/social/:platform/auth - start OAuth flow
router.get('/:platform/auth', (req, res) => {
  const platform = PLATFORMS[req.params.platform];
  if (!platform) return res.status(404).json({ error: 'Platform not found' });

  const clientId = platform.clientId();
  if (!clientId) return res.status(400).json({ error: `${platform.name} is not configured` });

  const accountId = req.query.accountId;
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  const state = Buffer.from(JSON.stringify({
    platform: req.params.platform,
    accountId,
  })).toString('base64');

  const redirectUri = `${req.protocol}://${req.get('host')}/api/social/callback`;

  let authUrl;
  if (req.params.platform === 'twitter') {
    // Twitter uses PKCE
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    // Store code verifier temporarily (in-memory, simple approach)
    global._twitterCodeVerifiers = global._twitterCodeVerifiers || {};
    global._twitterCodeVerifiers[accountId] = codeVerifier;

    authUrl = `${platform.authUrl}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(platform.scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  } else if (req.params.platform === 'tiktok') {
    authUrl = `${platform.authUrl}?client_key=${clientId}&response_type=code&scope=${encodeURIComponent(platform.scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  } else {
    authUrl = `${platform.authUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(platform.scope)}&response_type=code&state=${state}&access_type=offline&prompt=consent`;
  }

  res.redirect(authUrl);
});

// GET /api/social/callback - OAuth callback (shared across platforms)
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code || !state) {
    return res.redirect('/?social=error&reason=' + encodeURIComponent(error || 'No code received'));
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString());
  } catch (e) {
    return res.redirect('/?social=error&reason=invalid_state');
  }

  const { platform: platformKey, accountId } = stateData;
  const platform = PLATFORMS[platformKey];
  if (!platform) return res.redirect('/?social=error&reason=unknown_platform');

  const redirectUri = `${req.protocol}://${req.get('host')}/api/social/callback`;

  try {
    // Exchange code for tokens
    let tokenBody;
    let tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (platformKey === 'twitter') {
      const codeVerifier = (global._twitterCodeVerifiers || {})[accountId] || '';
      tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: platform.clientId(),
      }).toString();
      tokenHeaders['Authorization'] = 'Basic ' + Buffer.from(`${platform.clientId()}:${platform.clientSecret()}`).toString('base64');
    } else if (platformKey === 'tiktok') {
      tokenBody = new URLSearchParams({
        client_key: platform.clientId(),
        client_secret: platform.clientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString();
    } else {
      tokenBody = new URLSearchParams({
        client_id: platform.clientId(),
        client_secret: platform.clientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString();
    }

    const tokenRes = await fetch(platform.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`${platformKey} token exchange failed:`, errText);
      return res.redirect(`/?social=error&reason=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();

    // Save connection
    const connId = 'sc_' + Date.now();
    const existing = queryOne(
      'SELECT id FROM social_connections WHERE account_id = ? AND platform = ?',
      [accountId, platformKey]
    );

    if (existing) {
      run(
        `UPDATE social_connections SET access_token = ?, refresh_token = ?, token_expiry = ?,
         platform_username = ?, connected_at = datetime('now') WHERE id = ?`,
        [
          tokens.access_token,
          tokens.refresh_token || null,
          tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          tokens.screen_name || tokens.open_id || null,
          existing.id,
        ]
      );
    } else {
      run(
        `INSERT INTO social_connections (id, account_id, platform, access_token, refresh_token,
         token_expiry, platform_username, scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          connId, accountId, platformKey,
          tokens.access_token,
          tokens.refresh_token || null,
          tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          tokens.screen_name || tokens.open_id || null,
          platform.scope,
        ]
      );
    }

    res.redirect(`/?social=connected&platform=${platformKey}`);
  } catch (err) {
    console.error(`${platformKey} OAuth error:`, err.message);
    res.redirect('/?social=error&reason=' + encodeURIComponent(err.message));
  }
});

// GET /api/social/:platform/status - check connection
router.get('/:platform/status', (req, res) => {
  const accountId = getAccountId(req);
  if (!accountId) return res.json({ connected: false });

  const conn = queryOne(
    'SELECT * FROM social_connections WHERE account_id = ? AND platform = ?',
    [accountId, req.params.platform]
  );

  if (!conn) return res.json({ connected: false });

  res.json({
    connected: true,
    username: conn.platform_username,
    connectedAt: conn.connected_at,
  });
});

// DELETE /api/social/:platform/disconnect - disconnect
router.delete('/:platform/disconnect', (req, res) => {
  const accountId = getAccountId(req);
  if (!accountId) return res.status(400).json({ error: 'Not authenticated' });

  run(
    'DELETE FROM social_connections WHERE account_id = ? AND platform = ?',
    [accountId, req.params.platform]
  );

  res.json({ success: true });
});

// GET /api/social/:platform/content - browse content (placeholder)
router.get('/:platform/content', async (req, res) => {
  const accountId = getAccountId(req);
  const conn = queryOne(
    'SELECT * FROM social_connections WHERE account_id = ? AND platform = ?',
    [accountId, req.params.platform]
  );

  if (!conn) return res.status(403).json({ error: 'Not connected' });

  const platform = PLATFORMS[req.params.platform];
  if (!platform) return res.status(404).json({ error: 'Platform not found' });

  // Platform-specific content fetching
  try {
    let items = [];

    if (req.params.platform === 'youtube') {
      // YouTube Data API v3 — Bearer token is sufficient, no API key needed
      const response = await fetch(
        'https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=50',
        { headers: { 'Authorization': `Bearer ${conn.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        items = (data.items || []).map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
          date: item.snippet.publishedAt,
          category: item.snippet.title?.includes('#shorts') ? 'short' : 'video',
          url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
          sourceUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        }));
      }

    } else if (req.params.platform === 'instagram') {
      const response = await fetch(
        `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp&access_token=${conn.access_token}`
      );
      if (response.ok) {
        const data = await response.json();
        items = (data.data || []).map(item => ({
          id: item.id,
          title: item.caption || 'Instagram post',
          thumbnail: item.thumbnail_url || item.media_url,
          date: item.timestamp,
          category: item.media_type === 'VIDEO' ? 'reel' : 'post',
          url: item.media_url,
        }));
      }

    } else if (req.params.platform === 'tiktok') {
      // TikTok Video List API v2
      const response = await fetch('https://open.tiktokapis.com/v2/video/list/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${conn.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_count: 20,
          fields: 'id,title,cover_image_url,create_time',
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const videos = data.data?.videos || [];
        items = videos.map(video => ({
          id: video.id,
          title: video.title || 'TikTok video',
          thumbnail: video.cover_image_url || null,
          date: video.create_time ? new Date(video.create_time * 1000).toISOString() : null,
          category: 'video',
          url: video.cover_image_url || null,
        }));
      }

    } else if (req.params.platform === 'twitter') {
      // Twitter/X v2 API — get tweets with media attachments
      const response = await fetch(
        'https://api.twitter.com/2/users/me/tweets?max_results=100&expansions=attachments.media_keys&media.fields=url,preview_image_url,type&tweet.fields=created_at',
        { headers: { 'Authorization': `Bearer ${conn.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        const tweets = data.data || [];
        const mediaMap = {};
        if (data.includes?.media) {
          data.includes.media.forEach(m => { mediaMap[m.media_key] = m; });
        }
        for (const tweet of tweets) {
          const mediaKeys = tweet.attachments?.media_keys || [];
          for (const key of mediaKeys) {
            const media = mediaMap[key];
            if (media && (media.url || media.preview_image_url)) {
              items.push({
                id: `${tweet.id}_${key}`,
                title: tweet.text ? tweet.text.slice(0, 80) : 'Tweet media',
                thumbnail: media.preview_image_url || media.url,
                date: tweet.created_at || null,
                category: 'tweet',
                url: media.url || media.preview_image_url,
              });
            }
          }
        }
      }
    }

    res.json({ items, platform: platform.name });
  } catch (err) {
    console.error(`${req.params.platform} content error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// POST /api/social/:platform/import - import selected items
router.post('/:platform/import', async (req, res) => {
  const accountId = getAccountId(req);
  const conn = queryOne(
    'SELECT * FROM social_connections WHERE account_id = ? AND platform = ?',
    [accountId, req.params.platform]
  );

  if (!conn) return res.status(403).json({ error: 'Not connected' });

  const { items } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items to import' });
  }

  const platform = req.params.platform;
  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // SSE for progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let imported = 0;
  const s3Storage = require('../services/s3Storage');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    res.write(`event: progress\ndata: ${JSON.stringify({
      status: 'importing',
      current: i + 1,
      total: items.length,
      fileName: item.title || item.id,
    })}\n\n`);

    try {
      if (!item.url) continue;

      // Download the file
      const dlRes = await fetch(item.url);
      if (!dlRes.ok) continue;

      const buffer = Buffer.from(await dlRes.arrayBuffer());
      const ext = item.url.match(/\.\w+(?=\?|$)/)?.[0] || '.jpg';
      const tmpPath = path.join(os.tmpdir(), `cv_social_${Date.now()}${ext}`);
      fs.writeFileSync(tmpPath, buffer);

      // Upload to S3
      const mimeType = ext === '.mp4' ? 'video/mp4' : 'image/jpeg';
      const fileName = (item.title || item.id).replace(/[^a-zA-Z0-9 ._-]/g, '') + ext;
      const s3Key = await s3Storage.uploadFile(accountId, tmpPath, fileName, mimeType, false);

      // Create media entry
      const id = 'sm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const type = mimeType.startsWith('video/') ? 'video' : 'photo';

      const { run: dbRun } = require('../db/database');
      dbRun(
        `INSERT INTO media (id, account_id, person_name, person_email, type,
          original_name, stored_name, mime_type, size_bytes,
          has_thumbnail, drive_file_id, source_platform, source_category, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, accountId, account.name, account.email || '', type,
          fileName, fileName, mimeType, buffer.length,
          0, s3Key, platform, item.category || 'post',
          item.sourceUrl || item.url || null,
        ]
      );

      // Trigger AI analysis
      try {
        const aiAnalysis = require('../services/aiAnalysis');
        if (aiAnalysis.isConfigured()) aiAnalysis.enqueue(id);
      } catch (_) {}

      // Cleanup
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      imported++;
    } catch (err) {
      console.error(`Failed to import ${item.id}:`, err.message);
    }
  }

  res.write(`event: done\ndata: ${JSON.stringify({ imported, total: items.length })}\n\n`);
  res.end();
});

// ── URL Import (no API keys needed) ──────────────────

// POST /api/social/import-url — preview or import from a pasted URL
router.post('/import-url', async (req, res) => {
  const { url, action } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  const detected = scraper.detectPlatform(url);
  if (!detected) {
    return res.status(400).json({
      error: 'Unsupported URL. Paste a link from YouTube, Instagram, TikTok, or Twitter/X.',
    });
  }

  try {
    const item = await scraper.extractFromUrl(url);

    // Preview mode — just return metadata
    if (action === 'preview') {
      return res.json({ item });
    }

    // Import mode — download and save
    const accountId = getAccountId(req);
    if (!accountId) return res.status(400).json({ error: 'Not authenticated' });

    const account = queryOne('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // SSE for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`event: progress\ndata: ${JSON.stringify({
      status: 'downloading',
      fileName: item.title || item.id,
    })}\n\n`);

    let buffer;
    let ext = '.jpg';
    let mimeType = 'image/jpeg';
    let tmpPath;

    try {
      if (item.platform === 'youtube' && item.hasVideo) {
        // YouTube: use ytdl stream for actual video download
        const stream = scraper.downloadYouTubeStream(item.url || item.sourceUrl);
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
        ext = '.mp4';
        mimeType = 'video/mp4';
      } else if (item.url) {
        // Other platforms: fetch the media URL
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        const cookies = scraper.getCookies(item.platform);
        if (cookies) headers['Cookie'] = cookies;

        const dlRes = await fetch(item.url, { headers, redirect: 'follow' });
        if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);

        buffer = Buffer.from(await dlRes.arrayBuffer());

        // Detect type from content-type header or URL
        const ct = dlRes.headers.get('content-type') || '';
        if (ct.includes('video/') || item.url.includes('.mp4')) {
          ext = '.mp4';
          mimeType = 'video/mp4';
        } else if (ct.includes('image/png') || item.url.includes('.png')) {
          ext = '.png';
          mimeType = 'image/png';
        } else if (ct.includes('image/webp') || item.url.includes('.webp')) {
          ext = '.webp';
          mimeType = 'image/webp';
        }
      } else if (item.thumbnail) {
        // Fallback: at least save the thumbnail
        const dlRes = await fetch(item.thumbnail, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
        });
        if (!dlRes.ok) throw new Error('Could not download thumbnail');
        buffer = Buffer.from(await dlRes.arrayBuffer());
      } else {
        // No downloadable media — save as a link-only entry
        const id = 'url_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        run(
          `INSERT INTO media (id, account_id, person_name, person_email, type,
            original_name, stored_name, mime_type, size_bytes,
            has_thumbnail, drive_file_id, source_platform, source_category, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, accountId, account.name, account.email || '', 'link',
            item.title || 'Link', item.title || 'Link', 'text/uri-list', 0,
            0, null, item.platform, item.category || 'post',
            item.sourceUrl || url,
          ]
        );
        res.write(`event: done\ndata: ${JSON.stringify({
          imported: 1,
          total: 1,
          mediaId: id,
          title: item.title,
          platform: item.platform,
          savedAs: 'link',
        })}\n\n`);
        res.end();
        return;
      }
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return;
    }

    res.write(`event: progress\ndata: ${JSON.stringify({
      status: 'uploading',
      fileName: item.title || item.id,
    })}\n\n`);

    // Save to temp file
    const safeName = (item.title || item.id || 'import').replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 80);
    tmpPath = path.join(os.tmpdir(), `cv_url_${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, buffer);

    // Upload to S3
    const fileName = safeName + ext;
    const s3Key = await s3Storage.uploadFile(accountId, tmpPath, fileName, mimeType, false);

    // Create media entry
    const id = 'url_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const type = mimeType.startsWith('video/') ? 'video' : 'photo';

    run(
      `INSERT INTO media (id, account_id, person_name, person_email, type,
        original_name, stored_name, mime_type, size_bytes,
        has_thumbnail, drive_file_id, source_platform, source_category, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, accountId, account.name, account.email || '', type,
        fileName, fileName, mimeType, buffer.length,
        0, s3Key, item.platform, item.category || 'post',
        item.sourceUrl || url,
      ]
    );

    // Trigger AI analysis
    try {
      const aiAnalysis = require('../services/aiAnalysis');
      if (aiAnalysis.isConfigured()) aiAnalysis.enqueue(id);
    } catch (_) {}

    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch (_) {}

    res.write(`event: done\ndata: ${JSON.stringify({
      imported: 1,
      total: 1,
      mediaId: id,
      title: item.title,
      platform: item.platform,
    })}\n\n`);
    res.end();

  } catch (err) {
    console.error('URL import error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Import failed' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// GET /api/social/:platform/scrape — search/browse without OAuth
router.get('/:platform/scrape', async (req, res) => {
  const { platform } = req.params;
  const { q } = req.query;

  if (platform === 'youtube') {
    if (!q) return res.status(400).json({ error: 'Search query (q) is required' });

    try {
      const items = await scraper.searchYouTube(q, 20);
      res.json({
        items,
        platform: 'YouTube',
        scraperMode: true,
      });
    } catch (err) {
      console.error('YouTube scrape error:', err.message);
      res.status(500).json({ error: 'Search failed' });
    }
  } else {
    res.status(400).json({ error: `Scrape browsing not available for ${platform}` });
  }
});

module.exports = router;
