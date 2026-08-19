# Appium Test Suite — Manual Run Guide

Runs an Appium/WebdriverIO functional workflow suite (plus a static Android
Lint accessibility pass) against `release/mda.apk` on an Android emulator.

There is **one spec file**, [`specs/functional.spec.js`](specs/functional.spec.js),
that exercises every reachable flow in the app. Accessibility scanning is not
a separate spec or a separate synthetic navigation — it's the exact same
spec, run a second time with an `A11Y_SCAN` flag that makes every step also
run a real accessibility audit of whatever screen that step just produced.
See [Test suite](#test-suite) for how that works.

Results are printed to the console and written to JSON + HTML reports under
[`reports/`](#report-layout), split into a `functional/` folder and an `a11y/`
folder.

## Prerequisites

| Tool | Used version | Notes |
|---|---|---|
| JDK | 17 (Temurin) | required by the Android SDK tools |
| Android SDK cmdline-tools | 11076708 | provides `sdkmanager` / `avdmanager` |
| Android SDK platform-tools | latest | provides `adb` |
| Android SDK build-tools | 34.0.0 | provides `aapt2`, required by the Appium UiAutomator2 driver |
| Android system image | `system-images;android-34;google_apis;x86_64` | emulator image |
| Node.js | 18+ | for Appium / WebdriverIO |
| Appium | 3.x | test automation server |
| appium-uiautomator2-driver | 8.x | Android driver for Appium |

This repo's `appium-tests/` folder only contains the WebdriverIO test project
(`package.json`, `wdio.*.conf.js`, `specs/`). The Android SDK, JDK, and Appium
server are machine-wide tools — install them once per machine, not per repo.

### 1. Install JDK and Android SDK

These are the exact commands used to set this up from a bare machine (Git
Bash on Windows). Adjust paths/URLs for your OS/architecture as needed — this
guide uses `C:\tools` as the install root throughout.

**Download and extract a JDK 17** (Eclipse Temurin, via the Adoptium API —
this always resolves to the latest 17.x build for the given OS/arch):

**Set environment variables** (add to your shell profile so they persist —
replace the JDK folder name with whatever was extracted above):

```bash
export JAVA_HOME="C:\tools\jdk17\jdk-17.0.20+8"
export ANDROID_HOME="C:\tools\android-sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
```

**Install the required SDK packages via `sdkmanager`** (on Windows in Git
Bash, `sdkmanager` ships as `sdkmanager.bat` — call it with the extension, or
run this from PowerShell/cmd instead):

```bash
cd /c/tools/android-sdk/cmdline-tools/latest/bin
yes | ./sdkmanager.bat --sdk_root="C:\tools\android-sdk" \
  "platform-tools" \
  "build-tools;34.0.0" \
  "platforms;android-34" \
  "system-images;android-34;google_apis;x86_64" \
  "emulator"
```

`yes |` auto-accepts the SDK license prompts non-interactively — omit it if
you'd rather review and accept them yourself.

### 2. Create and boot an emulator (one-time setup, then boot each session)

Create the AVD once:

```bash
avdmanager create avd -n test_avd -k "system-images;android-34;google_apis;x86_64" --force
```

Boot it (headless, no window — drop `-no-window` if you want to see the screen):

```bash
emulator -avd test_avd -no-window -no-boot-anim -no-audio -gpu swiftshader_indirect -accel auto &
```

Wait until it's ready:

```bash
adb wait-for-device
adb shell getprop sys.boot_completed   # keep retrying until this prints "1"
adb devices                            # should list "emulator-5554  device"
```

### 3. Install Appium and the Android driver (once per machine)

```bash
npm install -g appium appium-uiautomator2-driver
appium driver install uiautomator2
```

### 4. Install this test project's dependencies (once per clone)

```bash
cd appium-tests
npm install
```

## Test suite

[`specs/functional.spec.js`](specs/functional.spec.js) drives the app through
every reachable flow:

| Flow | What it does |
|---|---|
| **Product catalog** | Catalog loads on launch; opens the sort dialog and applies all four orders (name asc/desc, price asc/desc). |
| **Product detail & cart** | Opens a product, adjusts quantity with the +/- controls, adds it to the cart, confirms the cart badge updates, opens the cart and confirms the item is listed. |
| **Checkout** | Taps checkout (unauthenticated → routed to Login), logs in with one of the app's built-in demo accounts, fills shipping info, fills payment info, completes the order, and returns to the catalog from the confirmation screen. |
| **Navigation drawer** | Opens WebView (enters a URL and loads it), QR Code Scanner, Geo Location, Drawing, and About from the drawer menu, then logs out (with the confirmation dialog) back to the catalog. |

It's a **behavioral** test — every `it()` asserts actual app state (element
text, cart badge value, which screen is now showing), not accessibility.

### How the accessibility scan piggybacks on it

There is intentionally no `accessibility.spec.js` / `wcag-scan.spec.js` /
`screenreader-tools.spec.js` anymore, and no second traversal that clicks
around the app on its own to "find" screens. Instead:

- [`wdio.a11y.conf.js`](wdio.a11y.conf.js) sets `process.env.A11Y_SCAN = 'true'`
  before handing off to the same `functional.spec.js` that
  [`wdio.functional.conf.js`](wdio.functional.conf.js) runs — wdio's worker
  processes inherit that env var.
- Inside `functional.spec.js`, every `it()` calls `auditCurrentScreen(name)`
  right after it finishes navigating/asserting, but the audit itself is a
  no-op unless `A11Y_SCAN` is set — so a plain `npm run test:functional` run
  does none of this extra work and stays fast.
- When `A11Y_SCAN` is set, `auditCurrentScreen()` runs the native checks
  against whatever screen that step just produced, each pulled out into its
  own reusable util (previously inlined in the now-deleted specs):
  - **Structural sweep** ([`utils/structuralAudit.js`](utils/structuralAudit.js)) —
    missing accessible labels, unlabeled icon controls, undersized touch
    targets.
  - **TalkBack evaluation** ([`utils/talkbackAudit.js`](utils/talkbackAudit.js) +
    [`utils/talkback.js`](utils/talkback.js)) — TalkBack is actually enabled
    on the device via `adb` in `before()` and disabled in `after()`; each
    screen is evaluated against TalkBack's real announcement precedence.
  - There is deliberately **no synthetic "WCAG-mapped native" layer**
    reshaping structural-sweep findings into axe-violation-looking objects.
    axe-core cannot inspect native Android views at all — it only
    understands a DOM — so a native-screen finding was never something
    axe-core actually reported, and labeling it that way would misattribute
    it. WCAG/axe-core coverage is exactly, and only, what `scanWebviewContexts()`
    below finds.
  - The **WebView screen** gets a real axe-core scan (`scanWebviewContexts()`)
    once it loads a URL, since that's the only screen in the app with an
    actual DOM for axe-core to inspect. This is the *only* source of
    WCAG/axe findings.
  - A best-effort **touch-exploration probe** and the **tool-availability
    report** (Axe DevTools for Mobile, Google Accessibility Scanner, Android
    ATF — see below) run once, at the same point `screenreader-tools.spec.js`
    used to run them.
- Every audited screen is tagged with a human-authored name describing what
  functional step produced it (`'checkout-payment'`, `'webview-loaded'`,
  `'product-catalog-after-logout'`, ...) — richer than the "nav-0", "nav-1"
  labels the old synthetic traversal produced, because the functional flow
  already knows what each screen *is*.
- `after()` writes the same three report files the old specs wrote
  (`accessibility-report.json`, `wcag-report.json`, `screenreader-report.json`),
  now covering real, reachable app states — login, checkout, drawer screens —
  that the old click-up-to-6-things traversal never visited.

### Accessibility tool coverage

The team asked about five specific accessibility tools. This is the honest
status of each, in this harness, against a prebuilt release APK:

| Tool | Status | Why |
|---|---|---|
| **TalkBack** | ✅ Actually run | Google's screen reader ships on this AVD image (`com.google.android.marvin.talkback`). Enabled for real via `adb shell settings put secure enabled_accessibility_services ...` in `functional.spec.js`'s `before()`, evaluated against every screen the functional flow visits, disabled again in `after()`. |
| **Android Lint** | ✅ Actually run | Unlike the three below, Lint is a *static* analyzer over source, not a device/APK check — and this repo has the app's own Gradle project (not just the built APK), so `npm run test:lint` genuinely runs `gradlew lintDebug` and filters its findings to the Accessibility category (`ContentDescription`, `ClickableViewAccessibility`, `LabelFor`, `SelectableText`, ...). See [`utils/androidLint.js`](utils/androidLint.js) / [`scripts/run-android-lint.js`](scripts/run-android-lint.js). |
| **Axe DevTools for Mobile** (Deque) | ❌ Not available | Commercial SDK that must be linked into the app at build time plus a paid API key — cannot be attached to a prebuilt release APK after the fact. Reported via `checkAxeDevToolsMobile()` in [`utils/toolAvailability.js`](utils/toolAvailability.js). |
| **Google Accessibility Scanner** | ❌ Not available | Play Store app with no public automation API — it's driven by tapping its own on-screen floating button and reading an overlay report. Nothing to call from Appium/adb. Also simply not installed on this Play-Store-less AVD image. Reported via `checkAccessibilityScanner()`. |
| **Android Accessibility Test Framework (ATF)** | ❌ Not available | ATF's checks run against live `View`/`AccessibilityNodeInfo` objects inside an *instrumented* Android test process (Espresso), compiled against the app's own source/build — not against a standalone XML dump from a prebuilt APK. Reported via `checkAndroidATF()`. |

The three ❌ rows are reported with the concrete reason and the manual/CI
steps to run them for real (see each function in `utils/toolAvailability.js`)
rather than faking results.

## Running the tests

**Start the Appium server** (leave running in its own terminal). Include
`--allow-insecure "*:adb_shell"` if you want the touch-exploration probe (in
the Navigation-drawer flow, only runs when `A11Y_SCAN` is set) to actually
run — it's skipped gracefully, not fatal, if you don't:

```bash
appium --allow-insecure "*:adb_shell"
```

Confirm it's listening on `http://127.0.0.1:4723` (this is what
`wdio.shared.conf.js` expects — see `hostname`/`port` there; both
`wdio.functional.conf.js` and `wdio.a11y.conf.js` inherit it).

**In a second terminal**, with the emulator booted and online (`adb devices`
shows `emulator-5554`), run tests from `appium-tests/`:

```bash
cd appium-tests

# run everything: functional run, then accessibility run, then Android Lint
npm test

# or run one at a time
npm run test:functional   # functional.spec.js, no accessibility auditing
npm run test:a11y         # the same functional.spec.js, with A11Y_SCAN=true, then test:lint
npm run test:lint         # Android Lint accessibility scan only (no emulator/Appium needed)

# or run wdio directly (e.g. to pass extra wdio CLI flags)
npx wdio run wdio.functional.conf.js
npx wdio run wdio.a11y.conf.js
```

WebdriverIO connects to the Appium server, which installs and launches
`release/mda.apk` on the emulator and runs `functional.spec.js` end to end —
there's no `--spec` flag needed since each config only points at that one
file. `npm run test:lint` is the exception — it's a plain Gradle build step
(`gradlew lintDebug`) and doesn't touch Appium/the emulator at all.

### Running on BrowserStack (no local emulator required)

[`wdio.browserstack.conf.js`](wdio.browserstack.conf.js) runs the
**accessibility scan** — the same `functional.spec.js` flow and audit logic
as `npm run test:a11y` (see "How the accessibility scan piggybacks on it"
above) — against a real device in BrowserStack App Automate instead of the
local emulator, so no Appium server or `adb`/emulator setup is needed on
your machine for this one. It always:

- tests this repo's own `release/mda.apk` (no env var to point it at a
  different app) — the config file uploads it fresh to BrowserStack's App
  Automate REST API on every run, **synchronously, before the config object
  is even built** (`utils/browserstackAppUpload.js`'s
  `uploadAppToBrowserStackSync`, shelling out to `curl`), and puts the
  resulting `bs://<app_id>` straight into the `appium:app` capability; see
  the note below on why it's done this way, and
- runs the accessibility scan, not a plain functional-only pass — it sets
  `A11Y_SCAN` itself, so there's nothing to configure for that either.

The only thing that's configurable is the device, via env vars (all optional
except the credentials):

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `BROWSERSTACK_USERNAME` | ✅ | — | Your BrowserStack account username |
| `BROWSERSTACK_ACCESS_KEY` | ✅ | — | Your BrowserStack account access key |
| `BROWSERSTACK_DEVICE_NAME` |  | `Google Pixel 7` | Device to run on |
| `BROWSERSTACK_DEVICE_VERSION` |  | `13.0` | Android (OS) version on that device |

> There is no "browser" involved in testing a native `.apk` — for BrowserStack
> App Automate, the equivalent of "browser name and version" is **device
> name** and **Android (OS) version**, which is what these env vars
> configure. Both credentials come from your BrowserStack account settings
> (browserstack.com/accounts/settings).

Copy [`.env.example`](.env.example) to `.env` in this folder and fill in
your credentials — `@wdio/cli` loads `.env` automatically on every
`npm run test:*` / `npx wdio run ...` invocation, so nothing else needs to
source it. `.env` is gitignored; never commit real credentials.

```bash
cd appium-tests
cp .env.example .env
# edit .env: set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY

npm run test:browserstack                                          # default device (Google Pixel 7, Android 13.0)

BROWSERSTACK_DEVICE_NAME="Samsung Galaxy S23" \
BROWSERSTACK_DEVICE_VERSION="13.0" \
npm run test:browserstack                                          # a different device
```

Like `npm run test:a11y`, this passes `includeMochaReports: false` to
[`wdio.shared.conf.js`](wdio.shared.conf.js) — the functional flow's mocha
pass/fail isn't accessibility data, so it isn't written anywhere. The real
accessibility findings land in the same `reports/a11y/` folder `npm run
test:a11y` uses (`accessibility-report.json`, `wcag-report.json`,
`screenreader-report.json`, `report.html`, `screenshot-report.html`) —
`functional.spec.js`'s `after()` hook writes those regardless of which
config (local emulator or BrowserStack) ran it, so a BrowserStack run
overwrites the same files a local `npm run test:a11y` run would. Check the
console output for the BrowserStack session URL to view the device video
and Appium logs on BrowserStack's own dashboard.

TalkBack enable/disable and the touch-exploration probe (both driven by the
local `adb` CLI — see `utils/talkback.js`) have no local device to talk to
when running against BrowserStack, so they're skipped automatically (logged,
not fatal) — see the "TalkBack setup skipped" troubleshooting note below.
Structural-sweep, WCAG/axe-core (WebView), and Android Lint checks are
unaffected, since none of them depend on local `adb` access.

**Why the app is uploaded via a direct, synchronous REST call instead of
letting `@wdio/browserstack-service` do it, or doing it from an
`onPrepare` hook**: two attempts before this one both failed in practice:

1. Handing the service a local file path (via a service-option `app`
   field) to auto-upload produced a raw/unresolved value BrowserStack's
   grid rejected with `BROWSERSTACK_INVALID_APP_CAP` ("app_url/custom_id/
   shareable_id ... is invalid").
2. Uploading it ourselves from an async `onPrepare` hook and mutating
   `capabilities` there looked correct (the documented pattern for
   computed capability values), but that mutation didn't reliably land
   before the runner's session request fired — the request went out with
   no `appium:app` set at all, and BrowserStack silently fell back to a
   plain Chrome browser session (`[chrome Android #0-0]` in the logs, with
   `functional.spec.js`'s native-app selectors then failing against a
   browser instead of erroring clearly about the missing app).

Uploading synchronously (`uploadAppToBrowserStackSync` in
[`utils/browserstackAppUpload.js`](utils/browserstackAppUpload.js), via
`curl` — Node has no synchronous HTTP client) at the top of
`wdio.browserstack.conf.js`, **before** `exports.config` is assigned,
removes the ordering question entirely: `capabilities[0]['appium:app']` is
already a real `bs://<app_id>` by the time WebdriverIO reads the config.
Bad credentials or a missing APK now fail loudly at config-load time
instead of silently degrading into a browser session. The
`@wdio/browserstack-service` is still used (for the BrowserStack
dashboard/build integration) with `skipAppOverride: true`, telling it not
to touch app upload/capabilities at all — see `validateSkipAppOverride` in
`@wdio/browserstack-service` if you want the exact mechanics.

> `functional.spec.js` locates elements by the resource-ids/text visible on
> each screen (`titleTV`, `cartTV`, `cartRL`, `menuIV`, `fullNameET`,
> `paymentBtn`, drawer item text like `"WebView"`/`"About"`, ...). These were
> written from the app's known screen structure (`app/src/main/res/layout/`,
> `app/src/main/java/.../view/fragments/`) but not exercised end-to-end in
> this session — if an element isn't found, use `adb shell uiautomator dump`
> or `driver.getPageSource()` to check the actual resource-id/text on that
> screen and adjust the locator.

## Report layout

Every run writes into `appium-tests/reports/`, split by suite so functional
and accessibility results never overwrite each other:

```
reports/
├── functional/
│   ├── json/
│   │   └── results-<cid>.json        # @wdio/json-reporter output — the functional pass/fail
│   └── html/
│       └── report.html               # aggregated wdio-html-nice-reporter report (functional pass/fail)
└── a11y/
    ├── json/
    │   ├── accessibility-report.json # structural-sweep findings across every audited screen
    │   ├── wcag-report.json          # { webview: [...] } — real axe-core findings, WebView contexts only
    │   ├── screenreader-report.json  # TalkBack findings + otherToolsRequested availability
    │   └── android-lint-report.json  # npm run test:lint output
    └── html/
        ├── report.html               # accessibility-findings-only HTML report (table view)
        ├── screenshot-report.html    # one screenshot per screen + deduplicated issue table w/ WCAG column
        └── android-lint-report.html  # copy of Gradle's own lint-results-debug.html
```

**`reports/a11y/` contains accessibility findings only — no functional
pass/fail.** The a11y suite runs the exact same `functional.spec.js` mocha
tests as the functional suite (that's how it reaches every screen), but
`wdio.a11y.conf.js` passes `includeMochaReports: false` to
[`wdio.shared.conf.js`](wdio.shared.conf.js), which skips wiring up wdio's
`json`/`html-nice` reporters entirely for that suite — so there's no
`results-<cid>.json` or mocha-shaped `report.html` under `reports/a11y/`.
Instead:

- The four `*-report.json` files under `a11y/json/` are written directly by
  `functional.spec.js`'s `after()` hook (see "Reading the results" below)
  and by `scripts/run-android-lint.js` — they carry the actual issue-level
  detail (screen, element bounds, WCAG tag, TalkBack announcement, etc.).
- `reports/a11y/html/report.html` is generated straight from those same
  accumulators by [`utils/generateA11yHtmlReport.js`](utils/generateA11yHtmlReport.js)
  — a plain findings table (counts + issue rows), not a test-suite report.
- `reports/a11y/html/screenshot-report.html` (generated by
  [`utils/generateA11yScreenshotReport.js`](utils/generateA11yScreenshotReport.js))
  is the visual counterpart: `functional.spec.js` calls `driver.takeScreenshot()`
  the first time each named screen is audited, and this report shows that
  screenshot next to a table of every issue found on it. The same UI element
  is often flagged by both native checks (e.g. the structural sweep's
  `missing-accessible-label` and TalkBack's `talkback-silent-stop` are both
  "this control has no accessible name" for the *same* button) — this report
  deduplicates those into one row per element, tagged with every check
  ("Reported by") that flagged it, rather than one row per check. WCAG/axe-core
  WebView findings are kept separate and never deduplicated against the
  native checks, since axe-core only ever scans a WebView's real DOM — there
  is no overlap between what it finds and what the native checks find. The
  header shows both **Total unique issues** (after dedup) and **Total issues
  found** (the raw, pre-dedup sum), so you can see how much native-check
  overlap there was.
- If you want to see the underlying functional pass/fail for a given a11y
  run too, run `npm run test:functional` separately — same spec, same app
  state reached, its own report in `reports/functional/`.
- Run `npm run clean:reports` to delete the whole `reports/` folder before a
  fresh run (this also clears stale files from any previous report shape).

## Reading the results

- **Functional run** (`npm run test:functional`): standard Mocha pass/fail
  per test case, in the console, in
  `reports/functional/json/results-<cid>.json`, and rendered in
  `reports/functional/html/report.html`. A failing assertion means the app's
  behavior regressed (or a locator went stale — check the resource-id note
  above).
- **Accessibility run** (`npm run test:a11y`): no pass/fail report — just
  accessibility findings, written by `functional.spec.js`'s `after()` hook:
  - `reports/a11y/json/accessibility-report.json` — structural-sweep issues,
    console-summarized as `=== Accessibility scan (driven by the functional
    test flow) === / Structural issues: N`.
  - `reports/a11y/json/wcag-report.json` — `{ webview: [...] }`, real
    axe-core violations from any WebView context found (empty in most runs,
    since this app is fully native except the WebView screen). There is no
    "native" section here — axe-core cannot inspect native Android views, so
    nothing from the structural sweep is reshaped into a fake WCAG finding.
    Native accessibility findings live in `accessibility-report.json` instead.
  - `reports/a11y/json/screenreader-report.json` —
    `{ screenReader: { tool, enabled, touchExplorationProbe, issues }, otherToolsRequested }`.
    Check `screenReader.enabled` to confirm TalkBack was actually running for
    the run you're looking at.
  - `reports/a11y/html/report.html` — the same data as a browsable page (see
    `utils/generateA11yHtmlReport.js`).
  - `reports/a11y/html/screenshot-report.html` — a screenshot per screen with
    its deduplicated issue table, a WCAG column, and tool badges (see
    `utils/generateA11yScreenshotReport.js`). For WebView/axe-core rows the
    WCAG value comes straight from axe-core's own tags; for native rows
    (structural sweep / TalkBack) it's a manual cross-reference to the
    closest WCAG 2.1 success criterion, not a claim that any tool evaluated
    it directly — axe-core cannot inspect native views. The header's "Total unique
    issues" vs. "Total issues found" tells you how much cross-tool overlap
    was collapsed.
  - Mocha still runs and can fail (e.g. a broken locator) during this suite,
    but that pass/fail isn't written anywhere under `reports/a11y/` — check
    the console for it, or run `npm run test:functional` for a persisted
    version of it.
- **Android Lint** (`npm run test:lint`): console ends with an accessibility
  issue count and one line per issue (id, severity, message, file:line); full
  data in `reports/a11y/json/android-lint-report.json`
  (`{ ran, totalIssues, accessibilityIssueCount, accessibilityIssues: [...] }`),
  plus Gradle's own full lint report (all categories, not just accessibility)
  copied to `reports/a11y/html/android-lint-report.html`. Unlike the Appium
  checks, `gradlew lintDebug` exits non-zero when it finds issues at or above
  its configured severity, which is why `test:lint` is invoked as a separate
  `&&`-chained step rather than a mocha assertion.

## Troubleshooting

- **`BROWSERSTACK_USERNAME is required to run wdio.browserstack.conf.js`**
  (or the access-key equivalent) — set both `BROWSERSTACK_USERNAME` and
  `BROWSERSTACK_ACCESS_KEY` before running `npm run test:browserstack`; see
  [Running on BrowserStack](#running-on-browserstack-no-local-emulator-required).
- **`TalkBack setup skipped (no local adb access to this device)`** — expected
  and non-fatal on `npm run test:browserstack`: `utils/talkback.js` drives
  TalkBack via the local `adb` CLI, which has no path to a remote
  BrowserStack device. `functional.spec.js` catches this and continues with
  `talkbackAvailable = false` for that run — every other check (structural
  sweep, WCAG/axe-core WebView scan, Android Lint) is unaffected. Run
  `npm run test:a11y` locally if you need real TalkBack coverage.
- **`[BROWSERSTACK_INVALID_APP_CAP] The app_url/ custom_id/ shareable_id
  specified in the 'app' capability ... is invalid`** on
  `npm run test:browserstack` — this is the exact failure mode the
  synchronous upload in `wdio.browserstack.conf.js` (see "Why the app is
  uploaded via a direct, synchronous REST call" above) exists to avoid, so
  seeing it again means the upload itself didn't produce a usable
  `bs://<app_id>`. Check the console for the "Uploading .../App uploaded:
  bs://..." lines printed at the very start of the run (before any test
  output) — if "App uploaded" never printed, the upload threw and you'd see
  a different, clearer error instead (see the next entry); if it did print
  a `bs://` URL and you still hit this, double check you haven't
  reintroduced a conflicting `appium:app` value or a service-level `app`
  option elsewhere in the config.
- **`Uploading .../release/mda.apk to BrowserStack App Automate...` prints,
  then a `BrowserStack app upload failed: curl: (22) ...` error, and the run
  exits before any test starts** — the synchronous upload step failed and
  is (correctly) failing fast rather than falling back to a browser
  session. `curl: (22) The requested URL returned error: 401` means
  `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` in your `.env` are
  wrong or expired — re-check them against
  browserstack.com/accounts/settings. Any other `curl` error (network
  timeout, DNS failure, etc.) means the upload request itself didn't reach
  BrowserStack — check your network/proxy settings.
- **Test output shows `[chrome Android #0-0]` and fails with `The selector
  "undefined" used with strategy "undefined" is invalid!`** — this means
  the BrowserStack session that actually started was a plain Chrome browser
  session, not an App Automate session running `mda.apk`, so
  `functional.spec.js`'s native-app element locators (`id=com.saucelabs...`)
  can't resolve to anything. This should no longer happen with the
  synchronous upload (it fails fast instead, per the entries above) — if
  you still see it, you're likely running an older cached
  `wdio.browserstack.conf.js` or have re-added an `onPrepare`-based upload;
  confirm the file matches the synchronous-upload version described in
  "Why the app is uploaded via a direct, synchronous REST call" above.
- **`Could not find 'aapt2.exe'`** — the Appium server was started before
  `build-tools;34.0.0` was installed, or `ANDROID_HOME` wasn't set in the
  terminal that launched `appium`. Install the build-tools package and
  restart the Appium server.
- **`'...SplashActivity' never started`** — the emulator likely isn't fully
  booted yet. Re-check `adb devices` / `adb shell getprop sys.boot_completed`
  before running the test; WebdriverIO will retry a few times but eventually
  gives up.
- **`Potentially insecure feature 'adb_shell' has not been enabled`** — the
  a11y run's `before()` hook tries to read the device's screen density via
  `mobile: shell` and this is disabled by default in Appium. It's non-fatal:
  the test falls back to a hardcoded density and continues. To get exact
  density readings, start Appium with `--relaxed-security` or
  `--allow-insecure adb_shell`.
- **`sdkmanager`/`avdmanager` not found in Git Bash** — on Windows these ship
  as `.bat` files; call them with the `.bat` extension (`sdkmanager.bat`) or
  run from PowerShell/cmd instead.
- **First TalkBack enable shows an "Allow Android Accessibility Suite to
  send you notifications?" system dialog** that steals focus from the app —
  `enableTalkBack()` in `utils/talkback.js` pre-grants
  `POST_NOTIFICATIONS` to TalkBack's package specifically to avoid this. If
  you still hit it (e.g. on a different Android version/AVD image), the
  audit will silently evaluate the wrong screen; dismiss the dialog manually
  once and it won't reappear on later runs on the same AVD.
- **Accessibility reports come back with `screenReader.enabled: false` and
  zero TalkBack issues** — this happens if
  `com.google.android.marvin.talkback` isn't installed on the device/AVD
  image (`functional.spec.js`'s `before()` sets `talkbackAvailable = false`
  and skips TalkBack evaluation entirely in that case). Use an AVD system
  image that includes Google APIs/Play services; the plain AOSP images don't
  ship TalkBack.
- **A step in the checkout/drawer flow fails only when `A11Y_SCAN=true`** —
  TalkBack is genuinely running on the device during the a11y suite (not just
  simulated), which can occasionally change layout/focus behavior. If a
  locator that passes under `test:functional` fails under `test:a11y`, check
  whether TalkBack's live-region/focus behavior is interfering, e.g. via
  `adb shell dumpsys accessibility`.
- **`Report Aggregation failed: ... Path contains invalid characters`** — the
  html-nice reporter/`ReportAggregator` joins `outputDir` onto
  `process.cwd()` itself, so `outputDir` must be a path *relative to
  `appium-tests/`*, not absolute. `wdio.shared.conf.js` already computes
  `htmlReportsDirRelative` for this reason — if you change the reports layout,
  keep passing a relative path to both the `html-nice` reporter options and
  the `ReportAggregator` constructor.
- **`npm run test:lint` fails with `gradlew: command not found` / permission
  denied** — run it from a shell where `./gradlew` (or `gradlew.bat` on
  Windows, which `scripts/run-android-lint.js` picks automatically via
  `process.platform`) is executable, and make sure `JAVA_HOME` is set (same
  JDK 17 requirement as the Android SDK tools above). This step needs the
  repo's Gradle project, not just `appium-tests/` — it must be run with the
  repo root as an ancestor of the working directory.
- **`npm run test:lint` reports `ran: false`** — check the `reason` field in
  `reports/a11y/json/android-lint-report.json`; it means `gradlew lintDebug`
  never produced `app/build/reports/lint-results-debug.xml` at all (as
  opposed to producing it with issues in it, which is the normal/expected
  case and still reports `ran: true`).
