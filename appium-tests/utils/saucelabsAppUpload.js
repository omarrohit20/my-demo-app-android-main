const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function sha256Of(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Looks up whether this exact APK (by sha256) is already sitting in Sauce's
 * app storage from a previous run, via GET /v1/storage/files?sha256=...
 * Sauce's upload endpoint is rate-limited to 5 requests per 15 minutes
 * (https://api.<region>.saucelabs.com/v1/storage/upload), which every local
 * re-run/retry of `npm run test:saucelabs` was blowing through re-uploading
 * an unchanged APK. Reusing the existing storage id when the content
 * matches avoids that limit entirely for the common case (iterating on the
 * test spec without rebuilding the app).
 */
function findExistingUpload({ username, accessKey, apkPath, region }) {
  const sha256 = sha256Of(apkPath);
  let body;
  try {
    body = execFileSync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '--user',
        `${username}:${accessKey}`,
        '--get',
        `https://api.${region}.saucelabs.com/v1/storage/files`,
        '--data-urlencode',
        `sha256=${sha256}`,
      ],
      { encoding: 'utf8' }
    );
  } catch (e) {
    // Lookup is a best-effort optimization — if it fails for any reason,
    // fall through to a real upload rather than blocking the run on it.
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return null;
  }
  const match = parsed.items && parsed.items[0];
  return match ? `storage:${match.id}` : null;
}

/**
 * Synchronous equivalent of BrowserStack's uploadAppToBrowserStackSync(), for
 * Sauce Labs App Automate. Uploads a local .apk to Sauce's storage API
 * (https://api.<region>.saucelabs.com/v1/storage/upload) via `curl` and
 * returns the `storage:<id>` value Sauce's Appium grid accepts for the
 * `appium:app` capability — a raw local file path is rejected.
 *
 * Done synchronously, at wdio-config module-load time (same reasoning as
 * wdio.browserstack.conf.js's upload): wdio config files are plain
 * synchronous CommonJS modules, so there is no way to `await` an async
 * upload before `exports.config` is read. An `onPrepare`-based upload would
 * depend on that mutation landing before the runner's session request goes
 * out, which is not a reliable ordering to depend on.
 */
function uploadAppToSauceLabsSync({ username, accessKey, apkPath, region = 'us-west-1' }) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`App not found at ${apkPath} — build/place the APK there before uploading to Sauce Labs.`);
  }

  const existing = findExistingUpload({ username, accessKey, apkPath, region });
  if (existing) {
    return existing;
  }

  let body;
  try {
    // --fail-with-body (curl >=7.76) still exits non-zero on a 4xx/5xx, but
    // writes the response body to stdout first instead of discarding it —
    // Sauce's error responses are JSON with the actual explanation.
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
        `https://api.${region}.saucelabs.com/v1/storage/upload`,
        '--form',
        `payload=@${apkPath}`,
        '--form',
        `name=${path.basename(apkPath)}`,
      ],
      { encoding: 'utf8' }
    );
  } catch (e) {
    const detail = (e.stdout && e.stdout.trim()) || e.stderr || e.message;
    throw new Error(
      `Sauce Labs app upload failed: ${detail}. If this doesn't look like a Sauce Labs error message, check SAUCE_USERNAME/SAUCE_ACCESS_KEY and SAUCE_REGION are correct.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`Could not parse Sauce Labs app upload response: ${body}`);
  }
  if (!parsed.item || !parsed.item.id) {
    throw new Error(`Sauce Labs app upload response had no item.id: ${body}`);
  }
  return `storage:${parsed.item.id}`;
}

module.exports = { uploadAppToSauceLabsSync };
