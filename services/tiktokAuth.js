/**
 * TikTok Web Login Service
 * Authenticates with TikTok via their internal passport API,
 * captures session cookies for use by the social scraper.
 *
 * Password uses XOR encryption with key 5.
 * Note: TikTok has aggressive bot detection — login may fail from server/cloud IPs.
 * Manual cookie paste remains available as fallback.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LOGIN_URL = 'https://www.tiktok.com/passport/web/user/login/';

/**
 * Parse Set-Cookie headers into a cookie object
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
 * XOR encrypt password with key (TikTok uses key=5)
 * Each character is XOR'd with the key, then hex-encoded
 */
function xorEncrypt(text, key = 5) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const xored = text.charCodeAt(i) ^ key;
    result += xored.toString(16).padStart(2, '0');
  }
  return result;
}

/**
 * Step 1: Get initial cookies and CSRF token from TikTok
 */
async function getInitialCookies() {
  try {
    const res = await fetch('https://www.tiktok.com/login/phone-or-email/email', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const cookies = parseSetCookies(res);

    // Also try fetching the main page if we didn't get enough cookies
    if (!cookies.ttwid && !cookies.msToken) {
      const mainRes = await fetch('https://www.tiktok.com/', {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      const mainCookies = parseSetCookies(mainRes);
      Object.assign(cookies, mainCookies);
    }

    // Extract CSRF token from cookies
    const csrfToken = cookies['tt_csrf_token'] || cookies['csrf_session_id'] || '';

    return {
      cookies,
      csrfToken,
    };
  } catch (err) {
    console.error('Failed to get TikTok initial cookies:', err.message);
    return null;
  }
}

/**
 * Main login function
 * Returns: { success, cookies, username } or { error }
 */
async function login(username, password) {
  try {
    // Step 1: Get initial cookies
    const init = await getInitialCookies();
    if (!init) {
      return { error: 'Could not connect to TikTok. Try again later.' };
    }

    let { cookies, csrfToken } = init;

    // Step 2: Encrypt password
    const encryptedPassword = xorEncrypt(password, 5);

    // Step 3: Build login request
    const loginBody = {
      mix_mode: 1,
      account_sdk_source: 'web',
      username: username,
      password: encryptedPassword,
      captcha: '',
      type: 31, // email login type
    };

    // Also try as JSON body
    const headers = {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.tiktok.com/login/phone-or-email/email',
      'Origin': 'https://www.tiktok.com',
      'Cookie': cookieString(cookies),
    };

    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
      headers['X-Secsdk-Csrf-Token'] = csrfToken;
    }

    // Step 4: POST to login endpoint
    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(loginBody),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    // Parse response cookies
    const responseCookies = parseSetCookies(loginRes);
    const allCookies = { ...cookies, ...responseCookies };

    // Parse response body
    let data;
    const responseText = await loginRes.text();
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('TikTok login response not JSON:', responseText.slice(0, 300));

      // If we got a redirect or HTML, TikTok may be blocking us
      if (responseText.includes('captcha') || responseText.includes('verify')) {
        return { error: 'TikTok requires CAPTCHA verification. Please use manual cookie paste instead.' };
      }
      return { error: 'Unexpected response from TikTok. Login may be blocked from this server.' };
    }

    // Handle success
    // TikTok returns data.data with user info on success
    if (data.data && (data.data.session_key || data.data.user_id || data.message === 'success')) {
      const sessionCookie = cookieString(allCookies);
      return {
        success: true,
        cookies: sessionCookie,
        username: username,
        userId: data.data.user_id?.toString() || data.data.uid?.toString() || '',
      };
    }

    // Handle specific error codes
    if (data.data?.error_code || data.data?.captcha) {
      const errorCode = data.data.error_code;

      // CAPTCHA required
      if (errorCode === 1105 || data.data.captcha) {
        return { error: 'TikTok requires CAPTCHA verification. Please use manual cookie paste instead.' };
      }

      // Rate limited
      if (errorCode === 7 || (data.data.description && data.data.description.includes('too frequent'))) {
        return { error: 'TikTok rate limit: too many login attempts. Wait a few minutes or use manual cookie paste.' };
      }

      // Wrong password
      if (errorCode === 1011 || errorCode === 1009) {
        return { error: 'Incorrect username or password.' };
      }

      // Account not found
      if (errorCode === 1008) {
        return { error: 'TikTok account not found. Check the username/email.' };
      }

      // 2FA required
      if (errorCode === 1040 || data.data.verify_type) {
        return { error: 'TikTok requires 2FA verification. Please log in via browser and use manual cookie paste.' };
      }
    }

    // Handle error messages
    if (data.message && data.message !== 'success') {
      // Clean up error message
      let msg = data.message;
      if (data.data?.description) msg = data.data.description;
      return { error: `TikTok: ${msg}` };
    }

    // Check if we actually got useful session cookies
    if (allCookies.sessionid || allCookies.sessionid_ss || allCookies.sid_tt) {
      return {
        success: true,
        cookies: cookieString(allCookies),
        username: username,
        userId: allCookies.uid_tt || '',
      };
    }

    return { error: 'TikTok login failed. The service may be blocking automated logins. Try manual cookie paste.' };
  } catch (err) {
    console.error('TikTok login error:', err);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'TikTok login timed out. Try again.' };
    }
    return { error: `Login failed: ${err.message}` };
  }
}

/**
 * TikTok doesn't have a standard 2FA API flow that we can automate.
 * If 2FA is required, the user should log in via browser and paste cookies manually.
 */
async function verify2FA() {
  return { error: 'TikTok 2FA must be completed in the browser. Please use manual cookie paste instead.' };
}

module.exports = {
  login,
  verify2FA,
};
