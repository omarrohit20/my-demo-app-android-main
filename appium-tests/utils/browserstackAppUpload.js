const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const FormData = require('form-data');

/**
 * Uploads a local .apk to BrowserStack's App Automate REST API directly
 * (https://api-cloud.browserstack.com/app-automate/upload) and returns the
 * `bs://<app_id>` URL BrowserStack assigns it, which is the only value its
 * Appium grid actually accepts for the `appium:app` capability — a raw
 * local file path or unresolved relative path gets rejected with
 * BROWSERSTACK_INVALID_APP_CAP.
 *
 * Done as an explicit REST call (rather than relying on
 * @wdio/browserstack-service's own local-path auto-upload, wired via
 * `skipAppOverride: true` in wdio.browserstack.conf.js) so this repo's app
 * upload path is easy to reason about and debug independent of that
 * service's internal capability-detection logic.
 */
function uploadAppToBrowserStack({ username, accessKey, apkPath }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(apkPath)) {
      reject(new Error(`App not found at ${apkPath} — build/place the APK there before uploading to BrowserStack.`));
      return;
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(apkPath), { filename: path.basename(apkPath) });

    const auth = Buffer.from(`${username}:${accessKey}`).toString('base64');
    const headers = { ...form.getHeaders(), Authorization: `Basic ${auth}` };

    const req = https.request(
      {
        method: 'POST',
        hostname: 'api-cloud.browserstack.com',
        path: '/app-automate/upload',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`BrowserStack app upload failed (HTTP ${res.statusCode}): ${body}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            reject(new Error(`Could not parse BrowserStack app upload response: ${body}`));
            return;
          }
          if (!parsed.app_url) {
            reject(new Error(`BrowserStack app upload response had no app_url: ${body}`));
            return;
          }
          resolve(parsed.app_url);
        });
      }
    );
    req.on('error', reject);
    form.pipe(req);
  });
}

/**
 * Synchronous equivalent of uploadAppToBrowserStack(), via `curl` rather
 * than the async https/form-data path above.
 *
 * wdio config files are plain synchronous CommonJS modules (`require`d, not
 * awaited) — there is no way to `await` an async upload before `exports.config`
 * is read. Doing the upload from an async `onPrepare` hook instead looks
 * correct, but depends on that hook's capability-mutation actually landing
 * before the runner spawns its session request; in this repo's actual runs
 * that ordering wasn't reliable — the session request went out with no
 * `appium:app` set, and BrowserStack silently fell back to a plain Chrome
 * browser session ("[chrome Android #0-0]") instead of failing loudly.
 * Uploading synchronously at module-load time, before `exports.config` is
 * even assigned, removes that ordering entirely: by the time WebdriverIO
 * reads `capabilities`, the real `bs://<app_id>` is already in it.
 */
function uploadAppToBrowserStackSync({ username, accessKey, apkPath }) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`App not found at ${apkPath} — build/place the APK there before uploading to BrowserStack.`);
  }

  let body;
  try {
    // --fail-with-body (curl >=7.76) still exits non-zero on a 4xx/5xx, but
    // — unlike plain --fail — writes the response body to stdout first
    // instead of discarding it. BrowserStack's error responses are JSON
    // with a real explanation (e.g. which field/limit was violated); losing
    // that body left errors like a 422 saying only "curl: (22) ... 422"
    // with no way to tell why.
    body = execFileSync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '--user',
        `${username}:${accessKey}`,
        '--request',
        'POST',
        'https://api-cloud.browserstack.com/app-automate/upload',
        '--form',
        `file=@${apkPath}`,
      ],
      { encoding: 'utf8' }
    );
  } catch (e) {
    // On failure, curl writes the (likely JSON) response body to stdout —
    // e.stdout here — and only puts its own "curl: (22) ..." summary on
    // stderr. Surface the response body when present; it's what actually
    // explains the failure (bad credentials, invalid/oversized app file,
    // plan limits, etc.), whereas the curl-level message is just "some
    // 4xx/5xx happened".
    const detail = (e.stdout && e.stdout.trim()) || e.stderr || e.message;
    throw new Error(
      `BrowserStack app upload failed: ${detail}. If this doesn't look like a BrowserStack error message, check BROWSERSTACK_USERNAME/BROWSERSTACK_ACCESS_KEY are correct.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`Could not parse BrowserStack app upload response: ${body}`);
  }
  if (!parsed.app_url) {
    throw new Error(`BrowserStack app upload response had no app_url: ${body}`);
  }
  return parsed.app_url;
}

module.exports = { uploadAppToBrowserStack, uploadAppToBrowserStackSync };
