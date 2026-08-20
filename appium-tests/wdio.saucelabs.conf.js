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
//   SAUCE_USERNAME       (required) Sauce Labs account username
//   SAUCE_ACCESS_KEY     (required) Sauce Labs account access key
//   SAUCE_REGION         data center region, e.g. "us-west-1" or "eu-central-1" (default below)
//   SAUCE_DEVICE_NAME    device to run on, e.g. "Google Pixel 7" (default below)
//   SAUCE_PLATFORM_VERSION Android version on that device, e.g. "13" (default below)
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

const region = process.env.SAUCE_REGION || 'us-west-1';
const deviceName = process.env.SAUCE_DEVICE_NAME || 'Google Pixel 7';
const platformVersion = process.env.SAUCE_PLATFORM_VERSION || '13';
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
console.log(`Uploading ${apkPath} to Sauce Labs (${region})...`);
const storageId = uploadAppToSauceLabsSync({ username, accessKey, apkPath, region });
console.log(`App uploaded: ${storageId}`);

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
  hostname: `ondemand.${region}.saucelabs.com`,
  port: 443,
  path: '/wd/hub',
  protocol: 'https',
  user: username,
  key: accessKey,
  capabilities: [
    {
      platformName: 'Android',
      'appium:app': storageId,
      'appium:deviceName': deviceName,
      'appium:platformVersion': platformVersion,
      'appium:automationName': 'UiAutomator2',
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 240,
      'sauce:options': {
        build: `MDA a11y — ${deviceName} ${platformVersion}`,
        name: 'functional.spec.js (accessibility scan)',
      },
    },
  ],
};
