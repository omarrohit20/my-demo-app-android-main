const { execFileSync } = require('child_process');

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8' });
}

function isPackageInstalled(pkg) {
  try {
    return adb(['shell', 'pm', 'list', 'packages', pkg]).includes(pkg);
  } catch (e) {
    return false;
  }
}

// Google Accessibility Scanner (com.google.android.apps.accessibility.auditor)
// is a Play Store app with no public automation API. It's driven by tapping
// its own floating overlay button and reading results from an on-screen
// report/screenshot overlay it renders — there is nothing to call
// programmatically from Appium/adb. We can only detect whether it's present.
function checkAccessibilityScanner() {
  const pkg = 'com.google.android.apps.accessibility.auditor';
  const installed = isPackageInstalled(pkg);
  return {
    tool: 'Google Accessibility Scanner',
    available: false,
    installed,
    reason: installed
      ? 'Installed, but Accessibility Scanner has no public automation API — it renders results as an on-screen overlay after its floating button is tapped manually. Cannot be driven headlessly from Appium/adb.'
      : `Not installed on this device (package ${pkg} not found). It ships via Play Store and this emulator image has no Play Store/Google account signed in.`,
    manualSteps: [
      `Install from Play Store: ${pkg}`,
      'Enable it under Settings > Accessibility > Accessibility Scanner',
      'Launch the target app, tap the Scanner floating button, tap "Scan Screen"',
      'Repeat per screen and read results from the on-screen report',
    ],
  };
}

// Axe DevTools for Mobile (Deque) requires its native SDK to be linked into
// the app binary at build time plus a Deque license/API key — it cannot be
// attached to a prebuilt APK we don't control the source of. We only check
// whether credentials for it have been provided to this environment.
function checkAxeDevToolsMobile() {
  const apiKey = process.env.AXE_DEVTOOLS_API_KEY;
  return {
    tool: 'Axe DevTools for Mobile',
    available: false,
    installed: false,
    reason: apiKey
      ? 'AXE_DEVTOOLS_API_KEY is set, but the Axe DevTools Mobile SDK must be compiled into the app at build time to scan it — it cannot be attached to the prebuilt release/mda.apk after the fact.'
      : 'No AXE_DEVTOOLS_API_KEY configured, and the app was not built with the Axe DevTools Mobile SDK linked in. This is a commercial Deque product requiring both a license and app-level SDK integration at build time.',
    manualSteps: [
      'Get a Deque axe DevTools Mobile license and API key',
      'Link the axe DevTools Mobile SDK into the app module and rebuild the APK',
      'Run the axe DevTools Mobile CLI/companion app against the instrumented build',
    ],
  };
}

// Android Accessibility Test Framework (ATF) checks
// (com.google.android.apps.common.testing.accessibility.framework) execute
// against live android.view.View / AccessibilityNodeInfo objects inside an
// instrumented Android test process (e.g. an Espresso test compiled against
// this app). The published jar's classes reference real Android runtime
// behavior, not just the SDK's android.jar stub — running it outside an
// on-device instrumented test produces "Stub!" exceptions instead of results.
// Since we only have a prebuilt release APK (no source/instrumentation
// target), there is no way to host ATF's checks against it from here.
function checkAndroidATF() {
  return {
    tool: 'Android Accessibility Test Framework (ATF)',
    available: false,
    installed: false,
    reason:
      'ATF checks require running inside an instrumented Android test process (Espresso) against this app\'s own build, which needs the app source/build config, not just the release APK.',
    manualSteps: [
      'Add the ATF Gradle dependency to the app\'s instrumented test source set: com.google.android.apps.common.testing.accessibility.framework:accessibility-test-framework',
      'Write an Espresso test that runs AccessibilityChecks.enable() (or AccessibilityCheckPreset checks) against each screen',
      'Run via ./gradlew connectedAndroidTest with the app source checked out',
    ],
  };
}

// Android Lint (the "Accessibility" issue category — ContentDescription,
// ClickableViewAccessibility, LabelFor, SelectableText, ...) is NOT reported
// here as "unavailable". Unlike the tools above, it's a static analyzer that
// runs directly against this repo's Gradle project (no device/emulator, no
// paid SDK) via `npm run test:lint`, which runs `gradlew lintDebug` and
// writes a real report to reports/a11y/json/android-lint-report.json and
// reports/a11y/html/android-lint-report.html — see utils/androidLint.js and
// scripts/run-android-lint.js.

module.exports = { checkAccessibilityScanner, checkAxeDevToolsMobile, checkAndroidATF, isPackageInstalled };
