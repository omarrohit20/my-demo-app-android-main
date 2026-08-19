const path = require('path');
const { createConfig } = require('./wdio.shared.conf');
const { uploadAppToBrowserStackSync } = require('./utils/browserstackAppUpload');

// Runs the accessibility scan (same functional.spec.js flow + audit logic
// as wdio.a11y.conf.js — see there and README.md, "How the accessibility
// scan piggybacks on it") against a real device in BrowserStack App
// Automate instead of a local emulator/Appium server. This config always
// runs the a11y scan (never a plain functional-only pass) and always tests
// this repo's own release/mda.apk — there is no env var to point it at a
// different app.
//
//   BROWSERSTACK_USERNAME       (required) BrowserStack account username
//   BROWSERSTACK_ACCESS_KEY     (required) BrowserStack account access key
//   BROWSERSTACK_DEVICE_NAME    device to run on, e.g. "Google Pixel 7" (default below)
//   BROWSERSTACK_DEVICE_VERSION Android version on that device, e.g. "13.0" (default below)
//
// Note: "browser name and version" for a native Android app on BrowserStack
// App Automate means device name + Android (OS) version, not a desktop
// browser — there is no browser involved in testing a native .apk.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required to run wdio.browserstack.conf.js. Set it to your BrowserStack ${
        name.includes('USERNAME') ? 'username' : 'access key'
      } (see https://www.browserstack.com/accounts/settings).`
    );
  }
  return value;
}

const deviceName = process.env.BROWSERSTACK_DEVICE_NAME || 'Google Pixel 7';
const deviceVersion = process.env.BROWSERSTACK_DEVICE_VERSION || '13.0';
const apkPath = path.resolve(__dirname, '..', 'release', 'mda.apk');
const username = requireEnv('BROWSERSTACK_USERNAME');
const accessKey = requireEnv('BROWSERSTACK_ACCESS_KEY');

// functional.spec.js reads this at require-time (same flag wdio.a11y.conf.js
// sets for the local run) to run its accessibility audit after every step
// instead of a plain functional pass.
process.env.A11Y_SCAN = 'true';

// Uploaded HERE — synchronously, at module-load time, before
// `exports.config` is even assigned — rather than from an async
// `onPrepare` hook. An `onPrepare`-based upload looks correct (mutate
// `capabilities` before sessions start) but depends on that mutation
// actually landing before the runner's session request fires; in practice
// that ordering was NOT reliable here — the request went out with no
// `appium:app` set, and BrowserStack silently fell back to a plain Chrome
// browser session ("[chrome Android #0-0]", selector errors from
// functional.spec.js running against a browser instead of the app) instead
// of failing loudly. Doing it synchronously removes the ordering question
// entirely: by the time WebdriverIO reads `capabilities` below, the real
// `bs://<app_id>` is already in it.
console.log(`Uploading ${apkPath} to BrowserStack App Automate...`);
const appUrl = uploadAppToBrowserStackSync({ username, accessKey, apkPath });
console.log(`App uploaded: ${appUrl}`);

// Reuses wdio.shared.conf.js's reporters/report-folder wiring, with
// includeMochaReports: false for the same reason wdio.a11y.conf.js uses
// it — this suite's mocha pass/fail describes the functional flow, not
// accessibility findings, so it shouldn't land under reports/a11y/ (see
// README.md, "Report layout"). The real accessibility-findings JSON/HTML
// reports are written directly by functional.spec.js's after() hook,
// regardless of which config (local emulator or this one) ran it.
const base = createConfig({
  suiteName: 'a11y',
  reportTitle: 'MDA Accessibility Test Report (BrowserStack)',
  specs: ['./specs/functional.spec.js'],
  includeMochaReports: false,
});

exports.config = {
  ...base,
  hostname: undefined,
  port: undefined,
  path: undefined,
  user: username,
  key: accessKey,
  // skipAppOverride: true tells @wdio/browserstack-service not to manage app
  // upload/injection itself — the sync upload above already put a valid
  // `appium:app` into every capability, so the service should leave it alone.
  services: [['browserstack', { skipAppOverride: true }]],
  capabilities: [
    {
      platformName: 'Android',
      'appium:app': appUrl,
      'appium:deviceName': deviceName,
      'appium:platformVersion': deviceVersion,
      'appium:automationName': 'UiAutomator2',
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 240,
      'bstack:options': {
        deviceName,
        osVersion: deviceVersion,
        projectName: 'MDA Appium Tests',
        buildName: `MDA a11y — ${deviceName} ${deviceVersion}`,
        sessionName: 'functional.spec.js (accessibility scan)',
        debug: true,
        networkLogs: true,
      },
    },
  ],
};
