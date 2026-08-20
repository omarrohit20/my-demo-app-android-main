const path = require('path');
const { createConfig } = require('./wdio.shared.conf');
const { uploadAppToSauceLabsSync } = require('./utils/saucelabsAppUpload');

// Runs the accessibility scan (same functional.spec.js flow + audit logic
// as wdio.a11y.conf.js/wdio.browserstack.conf.js — see there and
// README.md, "How the accessibility scan piggybacks on it") against a real
// device on Sauce Labs instead of a local emulator/Appium server. This
// config always runs the a11y scan (never a plain functional-only pass) and
// always tests this repo's own release/mda.apk — there is no env var to
// point it at a different app.
//
// Runs against Sauce Labs' Virtual Device Cloud (Android emulators), not
// Real Device Cloud — this account doesn't have RDC device access (every
// real device, including the widely-available Pixel 7, sat in an
// allocation queue and timed out; see conversation history). VDC uses a
// different `appium:deviceName` shape ("Android GoogleAPI Emulator" is a
// fixed pseudo-device name Sauce resolves to an actual Android emulator
// image, not a real phone model) and is provisioned separately from RDC.
//
//   SAUCE_USERNAME       (required) Sauce Labs account username
//   SAUCE_ACCESS_KEY     (required) Sauce Labs account access key
//   SAUCE_REGION         data center region, e.g. "us-west-1" or "eu-central-1" (default below)
//   SAUCE_DEVICE_NAME    emulator pseudo-device name, e.g. "Android GoogleAPI Emulator" (default below)
//   SAUCE_PLATFORM_VERSION Android version to emulate, e.g. "12.0" (default below)
//   SAUCE_BUILD_NAME     groups this run under a build in the Sauce dashboard (default below)
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required to run wdio.saucelabs.conf.js. Set it to your Sauce Labs ${
        name.includes('USERNAME') ? 'username' : 'access key'
      } (see https://app.saucelabs.com/user-settings).`
    );
  }
  return value;
}

// @wdio/sauce-service wants the short region code ('us' | 'eu' | 'apac'),
// not the full data-center name — accept either so SAUCE_REGION values like
// the upload API's "eu-central-1" (see saucelabsAppUpload.js, which calls
// api.<region>.saucelabs.com and does need the full name) still work here.
const regionAliases = { 'us-west-1': 'us', 'eu-central-1': 'eu', 'apac-southeast-1': 'apac' };
const rawRegion = process.env.SAUCE_REGION || 'us-west-1';
const region = regionAliases[rawRegion] || rawRegion;
const deviceName = process.env.SAUCE_DEVICE_NAME || 'Android GoogleAPI Emulator';
const platformVersion = process.env.SAUCE_PLATFORM_VERSION || '12.0';
const apkPath = path.resolve(__dirname, '..', 'release', 'mda.apk');
const username = requireEnv('SAUCE_USERNAME');
const accessKey = requireEnv('SAUCE_ACCESS_KEY');

// functional.spec.js reads this at require-time (same flag the other a11y
// configs set) to run its accessibility audit after every step instead of a
// plain functional pass.
process.env.A11Y_SCAN = 'true';

// Uploaded HERE — synchronously, at module-load time, before
// `exports.config` is even assigned — for the same ordering reason
// wdio.browserstack.conf.js uploads synchronously: an `onPrepare`-based
// upload's capability mutation isn't reliably guaranteed to land before the
// runner's session request fires.
//
// The upload's return value (a `storage:<id>` id) isn't used as the
// `appium:app` capability below — that capability instead references the
// app by its fixed filename (`storage:filename=mda.apk`), matching the
// capability shape requested for this run. This upload call still runs
// because it's what actually puts (or confirms) that file under that name
// in Sauce's app storage — `storage:filename=...` resolves to whatever the
// most recently uploaded file with that name is.
//
// SAUCE_APP_STORAGE_ID: set to a `storage:<id>` value (from a prior run's
// "App uploaded: ..." log line, or the Sauce Labs app storage UI) to skip
// the upload/lookup entirely — an escape hatch for Sauce's upload endpoint
// rate limit (5 requests / 15 min), since uploadAppToSauceLabsSync already
// looks up a matching sha256 before uploading and only falls back to an
// actual upload (which counts against that limit) when nothing matches yet.
if (process.env.SAUCE_APP_STORAGE_ID) {
  console.log(`Using SAUCE_APP_STORAGE_ID override: ${process.env.SAUCE_APP_STORAGE_ID} (app storage upload skipped)`);
} else {
  console.log(`Uploading ${apkPath} to Sauce Labs (${rawRegion})...`);
  const storageId = uploadAppToSauceLabsSync({ username, accessKey, apkPath, region: rawRegion });
  console.log(`App uploaded: ${storageId}`);
}
const appCapability = process.env.SAUCE_APP_STORAGE_ID || `storage:filename=${path.basename(apkPath)}`;

// Reuses wdio.shared.conf.js's reporters/report-folder wiring, with
// includeMochaReports: false for the same reason the other a11y configs use
// it — this suite's mocha pass/fail describes the functional flow, not
// accessibility findings, so it shouldn't land under reports/a11y/ (see
// README.md, "Report layout"). The real accessibility-findings JSON/HTML
// reports are written directly by functional.spec.js's after() hook,
// regardless of which config ran it.
const base = createConfig({
  suiteName: 'a11y',
  reportTitle: 'MDA Accessibility Test Report (Sauce Labs)',
  specs: ['./specs/functional.spec.js'],
  includeMochaReports: false,
});

exports.config = {
  ...base,
  // base (wdio.shared.conf.js) points hostname/port/path at a local Appium
  // server (127.0.0.1:4723) for the emulator runs — must be cleared here
  // (same as wdio.browserstack.conf.js does), otherwise webdriverio tries
  // to open a session against localhost instead of Sauce, which is what
  // produced ERR_SSL_PACKET_LENGTH_TOO_LONG (an https:// request hitting a
  // plain local Appium server).
  //
  // hostname/port are left undefined so webdriverio's own detectBackend()
  // (src/utils/detectBackend.ts) derives the right `ondemand.<region>.
  // saucelabs.com` host from `user`/`key` below. `path` is explicit
  // "/wd/hub" to match Sauce's own connection example for this account
  // (https://ondemand.eu-central-1.saucelabs.com:443/wd/hub) — this is the
  // Virtual Device Cloud emulator endpoint, not the Real Device Cloud one
  // that rejected the legacy path for Android 14+ earlier in this setup.
  hostname: undefined,
  port: undefined,
  path: '/wd/hub',
  // base's 120s connectionRetryTimeout is tuned for a local emulator, which
  // starts a session almost immediately. A real Sauce device can sit in an
  // allocation queue longer than that, especially for a specific
  // deviceName/platformVersion combo with few matching devices — give it
  // more room before giving up.
  connectionRetryTimeout: 300000,
  region,
  // Kept at the top level too (in addition to sauce:options.username/
  // accessKey below) so webdriverio's own detectBackend() still recognizes
  // this as a Sauce Labs connection and derives the right ondemand host —
  // see the hostname/port/path comment above.
  user: username,
  key: accessKey,
  services: [...(base.services || []), ['sauce', { sauceConnect: false }]],
  capabilities: [
    {
      platformName: 'Android',
      'appium:app': appCapability,
      'appium:deviceName': deviceName,
      'appium:platformVersion': platformVersion,
      'appium:automationName': 'UiAutomator2',
      'sauce:options': {
        username,
        accessKey,
        build: process.env.SAUCE_BUILD_NAME || 'appium-build-8VA6Z',
        name: 'functional.spec.js (accessibility scan)',
        deviceOrientation: 'PORTRAIT',
      },
    },
  ],
};
