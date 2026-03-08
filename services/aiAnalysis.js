const { ANTHROPIC_API_KEY } = require('../config');
const { queryOne, run } = require('../db/database');
const s3Storage = require('./s3Storage');

// Simple in-process job queue (no Redis needed)
const queue = [];
let processing = false;

function isConfigured() {
  return !!ANTHROPIC_API_KEY;
}

function enqueue(mediaId) {
  queue.push(mediaId);
  if (!processing) processNext();
}

async function processNext() {
  if (queue.length === 0) { processing = false; return; }
  processing = true;
  const id = queue.shift();
  try {
    await analyzeMedia(id);
  } catch (err) {
    console.error(`AI analysis failed for ${id}:`, err.message);
    try {
      run('UPDATE media SET ai_status = ? WHERE id = ?', ['failed', id]);
    } catch (_) {}
  }
  // Small delay between analyses to avoid rate limiting
  setTimeout(() => processNext(), 500);
}

async function analyzeMedia(mediaId) {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [mediaId]);
  if (!row) return;
  if (row.ai_status === 'done') return;

  // Mark as processing
  run('UPDATE media SET ai_status = ? WHERE id = ?', ['processing', mediaId]);

  // Only analyze images for now (video frame extraction requires ffmpeg)
  if (row.type !== 'photo' || !row.drive_file_id) {
    // For videos without ffmpeg, set a basic description
    if (row.type === 'video') {
      run('UPDATE media SET ai_description = ?, ai_tags = ?, ai_status = ? WHERE id = ?', [
        'Video file: ' + row.original_name,
        JSON.stringify(['video']),
        'done',
        mediaId,
      ]);
    }
    return;
  }

  try {
    // Download image from S3 into buffer
    const { stream } = await s3Storage.getFileStream(row.drive_file_id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);
    const base64Image = imageBuffer.toString('base64');

    // Determine media type for Claude
    const mimeType = row.mime_type || 'image/jpeg';
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mediaType = supportedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: 'Analyze this image. Return a JSON object with:\n- "description": A natural 1-2 sentence description of what\'s in the image\n- "tags": An array of 5-15 relevant searchable keywords/tags\n\nReturn ONLY valid JSON, no markdown formatting or code blocks.',
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', content);
      parsed = { description: content.slice(0, 200), tags: [] };
    }

    const description = parsed.description || '';
    const tags = Array.isArray(parsed.tags) ? parsed.tags : [];

    run('UPDATE media SET ai_description = ?, ai_tags = ?, ai_status = ? WHERE id = ?', [
      description,
      JSON.stringify(tags),
      'done',
      mediaId,
    ]);

    console.log(`AI analysis complete for ${row.original_name}: "${description.slice(0, 50)}..."`);
  } catch (err) {
    console.error(`AI analysis error for ${mediaId}:`, err.message);
    run('UPDATE media SET ai_status = ? WHERE id = ?', ['failed', mediaId]);
  }
}

function getQueueStatus() {
  return {
    queueLength: queue.length,
    processing,
  };
}

module.exports = { isConfigured, enqueue, analyzeMedia, getQueueStatus };
