/**
 * Instagram Web Login Service
 * Authenticates with Instagram via their web login endpoint,
 * captures session cookies for use by the social scraper.
 * Uses Node.js built-in crypto for Instagram's password encryption.
 */

const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Temporary in-memory store for 2FA state (5-minute TTL)
const twoFactorState = new Map();

function cleanExpiredState() {
  const now = Date.now();
  for (const [key, val] of twoFactorState) {
    if (val.expires < now) twoFactorState.delete(key);
  }
}

/**
 * Parse Set-Cookie headers into a merged cookie string
 */
function parseSetCookies(response) {
  const cookies = {};
  const raw = response.headers.getSetCookie?.() || [];
  for (const header of raw) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) {
      cookies[match[1].trim()] = match[2].trim();
    }
  }
  return cookies;
}

/**
 * Merge cookie objects into a single cookie string
 */
function cookieString(cookieObj) {
  return Object.entries(cookieObj)
    .filter(([_, v]) => v && v !== '""')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Step 1: Get CSRF token and initial cookies from Instagram
 */
async function getCSRFToken() {
  const res = await fetch('https://www.instagram.com/accounts/login/', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  const cookies = parseSetCookies(res);
  const csrftoken = cookies.csrftoken || '';

  // Also try to extract from HTML if not in cookies
  if (!csrftoken) {
    const html = await res.text();
    const match = html.match(/"csrf_token":"([^"]+)"/);
    if (match) {
      cookies.csrftoken = match[1];
    }
  }

  return {
    csrftoken: cookies.csrftoken || '',
    cookies,
  };
}

/**
 * Step 2: Get Instagram's encryption public key for password encryption
 */
async function getEncryptionKey(initialCookies, csrftoken) {
  try {
    // Try the shared data endpoint
    const res = await fetch('https://www.instagram.com/data/shared_data/', {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieString(initialCookies),
        'X-CSRFToken': csrftoken,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.encryption?.public_key && data.encryption?.key_id) {
        return {
          publicKey: data.encryption.public_key,
          keyId: parseInt(data.encryption.key_id),
          version: data.encryption.version || 10,
        };
      }
    }
  } catch (err) {
    console.error('Failed to get encryption key from shared_data:', err.message);
  }

  // Fallback: Try fetching the login page and extracting from HTML
  try {
    const res = await fetch('https://www.instagram.com/accounts/login/', {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieString(initialCookies),
      },
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();

    // Look for encryption config in the page
    const keyMatch = html.match(/"public_key":"([a-f0-9]+)"/);
    const idMatch = html.match(/"key_id":"?(\d+)"?/);
    const verMatch = html.match(/"version":"?(\d+)"?/);

    if (keyMatch && idMatch) {
      return {
        publicKey: keyMatch[1],
        keyId: parseInt(idMatch[1]),
        version: parseInt(verMatch?.[1] || '10'),
      };
    }
  } catch (err) {
    console.error('Failed to get encryption key from page:', err.message);
  }

  return null;
}

/**
 * Step 3: Encrypt password using Instagram's encryption scheme
 * Format: #PWD_INSTAGRAM_BROWSER:<version>:<timestamp>:<base64_payload>
 *
 * Instagram's public key is a hex-encoded RSA public key.
 * We use AES-256-GCM to encrypt the password, then RSA-OAEP to encrypt the AES key.
 */
function encryptPassword(password, publicKeyHex, keyId, version) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Generate random AES key and IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // AES-256-GCM encrypt the password
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(timestamp));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // RSA encrypt the AES key with Instagram's public key
  // Instagram provides a hex-encoded DER key — try multiple format approaches
  const publicKeyDer = Buffer.from(publicKeyHex, 'hex');
  let rsaKey;

  // Try SPKI format first (most common)
  try {
    rsaKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  } catch {
    // Try PKCS1 format
    try {
      rsaKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'pkcs1' });
    } catch {
      // Try wrapping as PEM
      const b64Key = publicKeyDer.toString('base64');
      const pem = `-----BEGIN PUBLIC KEY-----\n${b64Key.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
      rsaKey = crypto.createPublicKey({ key: pem, format: 'pem' });
    }
  }

  const encryptedAesKey = crypto.publicEncrypt(
    {
      key: rsaKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey
  );

  // Build the payload: [1, keyId, iv, sealed_size, encrypted_aes_key, tag, encrypted_password]
  const sealedSizeLE = Buffer.alloc(2);
  sealedSizeLE.writeUInt16LE(encryptedAesKey.length);

  const payload = Buffer.concat([
    Buffer.from([1]),                  // prefix
    Buffer.from([keyId]),              // key ID
    iv,                                // 12 bytes IV
    sealedSizeLE,                      // sealed key size (2 bytes, little endian)
    encryptedAesKey,                   // RSA-encrypted AES key
    authTag,                           // 16 bytes GCM tag
    encrypted,                         // AES-encrypted password
  ]);

  return `#PWD_INSTAGRAM_BROWSER:${version}:${timestamp}:${payload.toString('base64')}`;
}

/**
 * Fallback: Simple password encoding (version 0 = plaintext base64)
 * Used when encryption key is unavailable or encryption fails
 */
function encodePasswordSimple(password) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = Buffer.from(password).toString('base64');
  return `#PWD_INSTAGRAM_BROWSER:0:${timestamp}:${payload}`;
}

/**
 * Main login function
 * Returns: { success, cookies, username, userId } or { twoFactorRequired, ... } or { error }
 */
async function login(username, password) {
  try {
    // Step 1: Get CSRF token
    const { csrftoken, cookies: initialCookies } = await getCSRFToken();
    if (!csrftoken) {
      return { error: 'Could not get CSRF token from Instagram' };
    }

    // Step 2: Try to get encryption key for password encryption
    const encKey = await getEncryptionKey(initialCookies, csrftoken);

    // Step 3: Build login request body
    const body = new URLSearchParams();
    body.append('username', username);
    body.append('queryParams', '{}');
    body.append('optIntoOneTap', 'false');
    body.append('trustedDeviceRecords', '{}');

    if (encKey) {
      // Use encrypted password
      try {
        const encPassword = encryptPassword(password, encKey.publicKey, encKey.keyId, encKey.version);
        body.append('enc_password', encPassword);
      } catch (encErr) {
        console.error('Full encryption failed, trying simple encoding:', encErr.message);
        // Fallback: version 0 = plaintext base64 encoding
        body.append('enc_password', encodePasswordSimple(password));
      }
    } else {
      // No encryption key available — try simple encoding
      body.append('enc_password', encodePasswordSimple(password));
    }

    // Step 4: POST to login endpoint
    const loginRes = await fetch('https://www.instagram.com/accounts/login/ajax/', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Cookie': cookieString(initialCookies),
        'X-CSRFToken': csrftoken,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Instagram-AJAX': '1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.instagram.com/accounts/login/',
        'Origin': 'https://www.instagram.com',
      },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    // Parse response cookies
    const responseCookies = parseSetCookies(loginRes);
    const allCookies = { ...initialCookies, ...responseCookies };

    // Parse response body (read as text first to avoid double-read issues)
    let data;
    const responseText = await loginRes.text();
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Instagram login response not JSON:', responseText.slice(0, 200));
      return { error: 'Unexpected response from Instagram. Login may be blocked from this server.' };
    }

    // Handle authenticated response
    if (data.authenticated === true || data.status === 'ok') {
      const sessionCookie = cookieString(allCookies);
      const userId = data.userId || allCookies.ds_user_id || '';

      return {
        success: true,
        cookies: sessionCookie,
        username: username,
        userId: userId,
      };
    }

    // Handle 2FA
    if (data.two_factor_required) {
      const identifier = data.two_factor_info?.two_factor_identifier || '';
      const method = data.two_factor_info?.totp_two_factor_on ? 'totp' :
                     data.two_factor_info?.sms_two_factor_on ? 'sms' : 'unknown';

      // Store state for 2FA verification (5-minute TTL)
      cleanExpiredState();
      twoFactorState.set(username, {
        csrftoken: allCookies.csrftoken || csrftoken,
        cookies: allCookies,
        identifier,
        expires: Date.now() + 5 * 60 * 1000,
      });

      return {
        twoFactorRequired: true,
        identifier,
        method,
        username,
      };
    }

    // Handle checkpoint
    if (data.checkpoint_url || data.message === 'checkpoint_required') {
      return {
        error: 'Instagram requires a security checkpoint. Please log in via a browser first to verify your identity, then try again.',
        checkpoint: true,
      };
    }

    // Handle other errors
    if (data.message) {
      return { error: `Instagram: ${data.message}` };
    }
    if (data.status === 'fail') {
      return { error: data.message || 'Login failed. Check your credentials.' };
    }

    return { error: 'Login failed. Instagram may have changed their login flow.' };
  } catch (err) {
    console.error('Instagram login error:', err);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'Instagram login timed out. Try again.' };
    }
    return { error: `Login failed: ${err.message}` };
  }
}

/**
 * Verify 2FA code
 */
async function verify2FA(username, code, identifier) {
  cleanExpiredState();

  const state = twoFactorState.get(username);
  if (!state) {
    return { error: '2FA session expired. Please log in again.' };
  }

  try {
    const body = new URLSearchParams();
    body.append('username', username);
    body.append('verificationCode', code.replace(/\s/g, ''));
    body.append('identifier', identifier || state.identifier);
    body.append('queryParams', '{}');
    body.append('trustedDeviceRecords', '{}');

    const res = await fetch('https://www.instagram.com/accounts/login/two_factor/', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Cookie': cookieString(state.cookies),
        'X-CSRFToken': state.csrftoken,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Instagram-AJAX': '1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.instagram.com/accounts/login/two_factor/',
        'Origin': 'https://www.instagram.com',
      },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    const responseCookies = parseSetCookies(res);
    const allCookies = { ...state.cookies, ...responseCookies };

    let data;
    const responseText = await res.text();
    try {
      data = JSON.parse(responseText);
    } catch {
      return { error: 'Unexpected response from Instagram during 2FA verification.' };
    }

    if (data.authenticated === true || data.status === 'ok') {
      // Cleanup state
      twoFactorState.delete(username);

      return {
        success: true,
        cookies: cookieString(allCookies),
        username,
        userId: data.userId || allCookies.ds_user_id || '',
      };
    }

    if (data.message) {
      return { error: `Instagram: ${data.message}` };
    }

    return { error: 'Invalid 2FA code. Please try again.' };
  } catch (err) {
    console.error('Instagram 2FA error:', err);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: '2FA verification timed out. Try again.' };
    }
    return { error: `2FA verification failed: ${err.message}` };
  }
}

module.exports = {
  login,
  verify2FA,
};
