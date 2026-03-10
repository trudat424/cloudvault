/**
 * Twitter/X Web Login Service
 * Authenticates with Twitter/X via their internal task.json login flow,
 * captures session cookies for use by the social scraper.
 *
 * Flow: guest token → flow_token → submit username → submit password → (2FA) → cookies
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Public bearer token embedded in Twitter's JS bundle
const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAFXzAwAAAAAAMHCxpeSDG1gLNLghVe8d74hl6k4%3DRUMF4xAQLsbeBhTSRrCiQpJtxoGWeyHrDb5te2jpGskWDFW82F';

const TASK_URL = 'https://api.x.com/1.1/onboarding/task.json';

// Temporary in-memory store for 2FA state (5-minute TTL)
const twoFactorState = new Map();

function cleanExpiredState() {
  const now = Date.now();
  for (const [key, val] of twoFactorState) {
    if (val.expires < now) twoFactorState.delete(key);
  }
}

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
 * Step 1: Get a guest token from Twitter
 */
async function getGuestToken() {
  // First try to activate a guest token via the API
  try {
    const res = await fetch('https://api.x.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(10000),
    });

    const cookies = parseSetCookies(res);
    const data = await res.json();

    if (data.guest_token) {
      return {
        guestToken: data.guest_token,
        cookies,
      };
    }
  } catch (err) {
    console.error('Failed to get guest token via API:', err.message);
  }

  // Fallback: fetch x.com login page and extract guest token from HTML/cookies
  try {
    const res = await fetch('https://x.com/i/flow/login', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const cookies = parseSetCookies(res);
    const html = await res.text();

    // Try to extract guest token from the page
    const gtMatch = html.match(/gt=(\d{19})/);
    if (gtMatch) {
      return {
        guestToken: gtMatch[1],
        cookies,
      };
    }

    // Check if gt is in cookies
    if (cookies.gt) {
      return {
        guestToken: cookies.gt,
        cookies,
      };
    }
  } catch (err) {
    console.error('Failed to get guest token from page:', err.message);
  }

  return null;
}

/**
 * Make a request to the task.json endpoint
 */
async function taskRequest(payload, cookies, guestToken, csrfToken) {
  const headers = {
    'User-Agent': UA,
    'Authorization': `Bearer ${BEARER_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Guest-Token': guestToken,
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Client-Language': 'en',
  };

  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }
  if (cookies && Object.keys(cookies).length > 0) {
    headers['Cookie'] = cookieString(cookies);
  }

  const res = await fetch(TASK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });

  const responseCookies = parseSetCookies(res);
  const allCookies = { ...cookies, ...responseCookies };

  // Update CSRF token if set in cookies
  const newCsrf = responseCookies.ct0 || csrfToken;

  let data;
  const responseText = await res.text();
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error('Twitter task.json response not JSON:', responseText.slice(0, 300));
    return { error: 'Unexpected response from Twitter.', cookies: allCookies, csrfToken: newCsrf };
  }

  return {
    data,
    cookies: allCookies,
    csrfToken: newCsrf,
    flowToken: data.flow_token || null,
    subtasks: data.subtasks || [],
  };
}

/**
 * Check if a subtask list contains a specific subtask
 */
function hasSubtask(subtasks, id) {
  return subtasks.some(s => s.subtask_id === id);
}

/**
 * Main login function
 * Returns: { success, cookies, username } or { twoFactorRequired, ... } or { error }
 */
async function login(username, password) {
  try {
    // Step 1: Get guest token
    const guest = await getGuestToken();
    if (!guest) {
      return { error: 'Could not get guest token from Twitter. Try again later.' };
    }

    let { guestToken, cookies } = guest;
    let csrfToken = cookies.ct0 || '';

    // Step 2: Initialize login flow
    const initResult = await taskRequest({
      input_flow_data: {
        flow_context: {
          debug_overrides: {},
          start_location: { location: 'manual_link' },
        },
      },
      subtask_versions: {
        action_list: 2,
        alert_dialog: 1,
        app_download_cta: 1,
        check_logged_in_account: 1,
        choice_selection: 3,
        contacts_live_sync_permission_prompt: 0,
        cta: 7,
        email_verification: 2,
        end_flow: 1,
        enter_date: 1,
        enter_email: 2,
        enter_password: 5,
        enter_phone: 2,
        enter_recaptcha: 1,
        enter_text: 5,
        enter_username: 2,
        generic_urt: 3,
        in_app_notification: 1,
        interest_picker: 3,
        js_instrumentation: 1,
        menu_dialog: 1,
        notifications_permission_prompt: 2,
        open_account: 2,
        open_home_timeline: 1,
        open_link: 1,
        phone_verification: 4,
        privacy_options: 1,
        security_key: 3,
        select_avatar: 4,
        select_banner: 2,
        settings_list: 7,
        show_code: 1,
        sign_up: 2,
        sign_up_review: 4,
        tweet_selection_urt: 1,
        update_users: 1,
        upload_media: 1,
        user_recommendations_list: 4,
        user_recommendations_urt: 1,
        wait_spinner: 3,
        web_modal: 1,
      },
    }, cookies, guestToken, csrfToken);

    if (initResult.error) {
      return { error: initResult.error };
    }

    let flowToken = initResult.flowToken;
    cookies = initResult.cookies;
    csrfToken = initResult.csrfToken;

    if (!flowToken) {
      return { error: 'Could not initialize Twitter login flow.' };
    }

    // Step 3: Handle JS instrumentation subtask (if present)
    if (hasSubtask(initResult.subtasks, 'LoginJsInstrumentationSubtask')) {
      const jsResult = await taskRequest({
        flow_token: flowToken,
        subtask_inputs: [{
          subtask_id: 'LoginJsInstrumentationSubtask',
          js_instrumentation: {
            response: '{}',
            link: 'next_link',
          },
        }],
      }, cookies, guestToken, csrfToken);

      if (jsResult.error) return { error: jsResult.error };
      flowToken = jsResult.flowToken || flowToken;
      cookies = jsResult.cookies;
      csrfToken = jsResult.csrfToken;
    }

    // Step 4: Submit username
    const usernameResult = await taskRequest({
      flow_token: flowToken,
      subtask_inputs: [{
        subtask_id: 'LoginEnterUserIdentifierSSO',
        settings_list: {
          setting_responses: [{
            key: 'user_identifier',
            response_data: {
              text_data: { result: username },
            },
          }],
          link: 'next_link',
        },
      }],
    }, cookies, guestToken, csrfToken);

    if (usernameResult.error) return { error: usernameResult.error };
    flowToken = usernameResult.flowToken || flowToken;
    cookies = usernameResult.cookies;
    csrfToken = usernameResult.csrfToken;

    // Check for error responses
    if (usernameResult.data?.errors) {
      const errMsg = usernameResult.data.errors[0]?.message || 'Username not found.';
      return { error: `Twitter: ${errMsg}` };
    }

    // Check if Twitter is asking for alternate identifier (email/phone verification)
    if (hasSubtask(usernameResult.subtasks, 'LoginEnterAlternateIdentifierSubtask')) {
      return {
        error: 'Twitter requires additional identity verification (email or phone). Please log in via browser first, then try again or use manual cookie paste.',
      };
    }

    // Step 5: Submit password
    if (!hasSubtask(usernameResult.subtasks, 'LoginEnterPassword')) {
      // Check for any error subtasks
      const errorSubtask = usernameResult.subtasks.find(s =>
        s.subtask_id?.includes('Error') || s.subtask_id?.includes('Denied')
      );
      if (errorSubtask) {
        return { error: 'Twitter login denied. The account may be suspended or locked.' };
      }
      return { error: 'Unexpected Twitter login state. Password step not found.' };
    }

    const passwordResult = await taskRequest({
      flow_token: flowToken,
      subtask_inputs: [{
        subtask_id: 'LoginEnterPassword',
        enter_password: {
          password: password,
          link: 'next_link',
        },
      }],
    }, cookies, guestToken, csrfToken);

    if (passwordResult.error) return { error: passwordResult.error };
    flowToken = passwordResult.flowToken || flowToken;
    cookies = passwordResult.cookies;
    csrfToken = passwordResult.csrfToken;

    // Check for wrong password
    if (passwordResult.data?.errors) {
      const errMsg = passwordResult.data.errors[0]?.message || 'Wrong password.';
      return { error: `Twitter: ${errMsg}` };
    }

    // Check for 2FA requirement
    if (hasSubtask(passwordResult.subtasks, 'LoginTwoFactorAuthChallenge')) {
      cleanExpiredState();
      twoFactorState.set(username, {
        flowToken,
        cookies,
        guestToken,
        csrfToken,
        expires: Date.now() + 5 * 60 * 1000,
      });

      return {
        twoFactorRequired: true,
        method: 'totp',
        username,
      };
    }

    // Step 6: Handle AccountDuplicationCheck (if present)
    if (hasSubtask(passwordResult.subtasks, 'AccountDuplicationCheck')) {
      const dupResult = await taskRequest({
        flow_token: flowToken,
        subtask_inputs: [{
          subtask_id: 'AccountDuplicationCheck',
          check_logged_in_account: {
            link: 'AccountDuplicationCheck_false',
          },
        }],
      }, cookies, guestToken, csrfToken);

      cookies = dupResult.cookies;
      csrfToken = dupResult.csrfToken;
    }

    // Check if we got auth cookies
    if (cookies.auth_token) {
      return {
        success: true,
        cookies: cookieString(cookies),
        username: username,
        userId: cookies.twid ? cookies.twid.replace('u%3D', '') : '',
      };
    }

    // If we got ct0 but no auth_token, the login may need more steps
    if (passwordResult.subtasks.length === 0 || hasSubtask(passwordResult.subtasks, 'LoginSuccessSubtask')) {
      return {
        success: true,
        cookies: cookieString(cookies),
        username: username,
        userId: cookies.twid ? cookies.twid.replace('u%3D', '') : '',
      };
    }

    return { error: 'Twitter login completed but no session cookies received. Try again or use manual cookie paste.' };
  } catch (err) {
    console.error('Twitter login error:', err);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'Twitter login timed out. Try again.' };
    }
    return { error: `Login failed: ${err.message}` };
  }
}

/**
 * Verify 2FA code
 */
async function verify2FA(username, code) {
  cleanExpiredState();

  const state = twoFactorState.get(username);
  if (!state) {
    return { error: '2FA session expired. Please log in again.' };
  }

  try {
    const result = await taskRequest({
      flow_token: state.flowToken,
      subtask_inputs: [{
        subtask_id: 'LoginTwoFactorAuthChallenge',
        enter_text: {
          text: code.replace(/\s/g, ''),
          link: 'next_link',
        },
      }],
    }, state.cookies, state.guestToken, state.csrfToken);

    const cookies = result.cookies;

    if (result.data?.errors) {
      const errMsg = result.data.errors[0]?.message || 'Invalid 2FA code.';
      return { error: `Twitter: ${errMsg}` };
    }

    // Handle AccountDuplicationCheck after 2FA
    if (hasSubtask(result.subtasks, 'AccountDuplicationCheck')) {
      const dupResult = await taskRequest({
        flow_token: result.flowToken,
        subtask_inputs: [{
          subtask_id: 'AccountDuplicationCheck',
          check_logged_in_account: {
            link: 'AccountDuplicationCheck_false',
          },
        }],
      }, cookies, state.guestToken, result.csrfToken);

      Object.assign(cookies, dupResult.cookies);
    }

    // Check for auth cookies
    if (cookies.auth_token) {
      twoFactorState.delete(username);
      return {
        success: true,
        cookies: cookieString(cookies),
        username,
        userId: cookies.twid ? cookies.twid.replace('u%3D', '') : '',
      };
    }

    return { error: 'Invalid 2FA code. Please try again.' };
  } catch (err) {
    console.error('Twitter 2FA error:', err);
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
