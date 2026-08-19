# Appium Accessibility Test — Manual Run Guide

Runs an Appium/WebdriverIO accessibility audit (plus a functional smoke test
and a static Android Lint accessibility pass) against `release/mda.apk` on an
Android emulator.

Results are printed to the console and written to JSON + HTML reports under
[`reports/`](#reading-the-results), split into a `functional/` folder and an
`a11y/` folder.

## Test type

This is a **static/structural accessibility audit of the native Android UI
tree**, not a WCAG/axe-style automated scan and not a functional/UI test.

- **How it inspects the app**: for each screen, the test calls
  `driver.getPageSource()`, which asks the on-device UiAutomator2
  instrumentation to dump the current **accessibility node tree** (the same
  tree TalkBack reads from) as XML. The test never touches app internals or
  source code — everything it knows comes from what Android's own
  accessibility layer exposes at runtime.
- **How screens are reached**: the first screen audited is whatever the app
  shows right after launch (`SplashActivity` → Products list). A second pass
  then clicks up to 6 clickable container elements it finds (a heuristic for
  "things that might be nav/menu entries") and re-audits whatever appears
  after each click. This is a simple traversal, not full navigation coverage —
  screens reachable only via multi-step flows (login, checkout, deep menus)
  are not visited automatically.
- **Checks performed**, per element in the tree:
  1. **Missing accessible label** — `clickable="true"` (or
     `long-clickable="true"`) with no `text` and no `content-desc`. TalkBack
     has nothing to announce for this element.
  2. **Unlabeled icon control** — a clickable `ImageView` specifically with no
     `content-desc`. Same root cause as (1), called out separately because
     icon-only buttons are the most common source of this problem.
  3. **Undersized touch target** — a clickable element whose `bounds`
     (converted from px to dp using the device's screen density) is smaller
     than 48x48dp in either dimension, the minimum Android/WCAG 2.5.5
     recommended target size.
- **What this does *not* check**: text/background colour contrast, focus
  order, TalkBack read-order/grouping, dynamic type/font scaling, RTL layout,
  or anything requiring visual rendering — none of that is derivable from the
  accessibility node tree alone. Treat this as a first-pass structural sweep,
  not a substitute for a manual TalkBack walkthrough or a full WCAG audit.
- **Pass/fail semantics**: the two Mocha test cases (`audits the initial
  screen`, `audits reachable screens via bottom navigation / menu`) assert
  only that the audit *executed* — they pass even when accessibility issues
  are found. The actual result is the issue count/content in the console
  summary and `reports/a11y/json/accessibility-report.json`, not the green
  checkmarks.

The audit logic lives in [`specs/accessibility.spec.js`](specs/accessibility.spec.js)
(`walk()` and `auditScreen()`); the min touch-target size is configurable via
the `MIN_TOUCH_TARGET_DP` constant at the top of that file.

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

## Test suites

There are four specs under `specs/`, split across **two independent wdio
configs** so functional and accessibility runs get their own report folders
(see [Report layout](#report-layout)) and can be run without needing each
other:

| Config | Runs | Specs |
|---|---|---|
| [`wdio.functional.conf.js`](wdio.functional.conf.js) | `npm run test:functional` | `functional.spec.js` |
| [`wdio.a11y.conf.js`](wdio.a11y.conf.js) | `npm run test:a11y` | `accessibility.spec.js`, `wcag-scan.spec.js`, `screenreader-tools.spec.js` (then `test:lint`, see below) |

Both configs are generated by the shared factory in
[`wdio.shared.conf.js`](wdio.shared.conf.js) — same Appium
capabilities/connection settings, only the spec list, report folder, and
report title differ per suite.

| Spec | Type | What it does |
|---|---|---|
| [`functional.spec.js`](specs/functional.spec.js) | Functional / behavioral | Exercises the core shopping flow — catalog loads, add a product to cart, cart badge updates, cart shows the item, nav drawer opens. Asserts actual app *behavior*, not accessibility. |
| [`accessibility.spec.js`](specs/accessibility.spec.js) | Native accessibility audit | Structural sweep of the accessibility node tree for missing labels, unlabeled icon buttons, undersized touch targets. See the "Test type" section below. |
| [`wcag-scan.spec.js`](specs/wcag-scan.spec.js) | WCAG-mapped scan (axe-core + native) | Runs axe-core against any WebView context (there are none in this fully-native app, so that part reports 0 contexts scanned) and runs the same native structural checks as `accessibility.spec.js`, but reported with explicit WCAG 2.1 success-criteria tags (4.1.2, 1.1.1, 2.5.5) in one combined report. |
| [`screenreader-tools.spec.js`](specs/screenreader-tools.spec.js) | Screen reader (TalkBack) functional scan + tool availability report | Actually enables Google TalkBack on the device via `adb`, exercises the app while it's running, and evaluates every screen against TalkBack's real announcement rules. Also reports on Axe DevTools for Mobile, Google Accessibility Scanner, and Android ATF — see below for why those three can't run from this harness (Android Lint, the fifth tool the team asked about, *can* run — see below). |

**Why there's no real axe-core scan here**: axe-core inspects the DOM. This
app (`mda.apk`) is 100% native Android views — there is no DOM for axe-core to
read unless a screen embeds a WebView. `wcag-scan.spec.js` still calls
`driver.getContexts()` and runs axe against any WebView it finds, so if a
WebView is ever added to the app, this spec starts covering it automatically
with no changes needed. Until then, its WCAG coverage comes from the native
checks, not from axe.

### Accessibility tool coverage

The team asked about five specific accessibility tools. This is the honest
status of each, in this harness, against a prebuilt release APK:

| Tool | Status | Why |
|---|---|---|
| **TalkBack** | ✅ Actually run | Google's screen reader ships on this AVD image (`com.google.android.marvin.talkback`). `screenreader-tools.spec.js` enables it for real via `adb shell settings put secure enabled_accessibility_services ...`, exercises the app, evaluates every node's speakable text the way TalkBack itself computes it, then disables the service again in `after()`. |
| **Android Lint** | ✅ Actually run | Unlike the three below, Lint is a *static* analyzer over source, not a device/APK check — and this repo has the app's own Gradle project (not just the built APK), so `npm run test:lint` genuinely runs `gradlew lintDebug` and filters its findings to the Accessibility category (`ContentDescription`, `ClickableViewAccessibility`, `LabelFor`, `SelectableText`, ...). See [`utils/androidLint.js`](utils/androidLint.js) / [`scripts/run-android-lint.js`](scripts/run-android-lint.js). |
| **Axe DevTools for Mobile** (Deque) | ❌ Not available | Commercial SDK that must be linked into the app at build time plus a paid API key — cannot be attached to a prebuilt release APK after the fact. Reported via `checkAxeDevToolsMobile()` in [`utils/toolAvailability.js`](utils/toolAvailability.js). |
| **Google Accessibility Scanner** | ❌ Not available | Play Store app with no public automation API — it's driven by tapping its own on-screen floating button and reading an overlay report. Nothing to call from Appium/adb. Also simply not installed on this Play-Store-less AVD image. Reported via `checkAccessibilityScanner()`. |
| **Android Accessibility Test Framework (ATF)** | ❌ Not available | ATF's checks run against live `View`/`AccessibilityNodeInfo` objects inside an *instrumented* Android test process (Espresso), compiled against the app's own source/build — not against a standalone XML dump from a prebuilt APK. Reported via `checkAndroidATF()`. |

The three ❌ rows are reported with the concrete reason and the manual/CI
steps to run them for real (see each function in `utils/toolAvailability.js`)
rather than faking results.

### `screenreader-tools.spec.js` in detail

**What the TalkBack checks actually verify** (in
[`utils/talkback.js`](utils/talkback.js) and the spec's
`evaluateScreenForTalkBack()`):
- `talkback-silent-stop` — a focusable element TalkBack would land on during
  linear (swipe) navigation but that has no `content-desc`/`text` to speak.
- `talkback-unreachable-control` — an element that responds to touch
  (`clickable="true"`) but is marked `a11y-important="false"`, so TalkBack
  skips it entirely during navigation even though a sighted user can tap it.
- `talkback-ambiguous-announcement` — two or more distinct focusable elements
  that would all announce identical text with no distinguishing context (a
  TalkBack user can't tell them apart by ear).
- A best-effort **touch-exploration probe**: sends a real synthetic swipe via
  `adb shell input touchscreen swipe` (through `mobile: shell`, which needs
  Appium started with `--allow-insecure "*:adb_shell"` — see below) and
  reports whether the on-screen state changed. This is logged, not asserted,
  since synthetic touch events don't reliably trigger TalkBack's hover/dwell
  detection on every emulator configuration.

## Running the tests

**Start the Appium server** (leave running in its own terminal). Include
`--allow-insecure "*:adb_shell"` if you want `screenreader-tools.spec.js`'s
touch-exploration probe to actually run (it's skipped gracefully, not fatal,
if you don't):

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

# run everything: functional suite, then accessibility suite, then Android Lint
npm test

# or run one suite at a time
npm run test:functional   # functional.spec.js only
npm run test:a11y         # accessibility.spec.js + wcag-scan.spec.js + screenreader-tools.spec.js, then test:lint
npm run test:lint         # Android Lint accessibility scan only (no emulator/Appium needed)

# or run wdio directly for a single spec within a suite
npx wdio run wdio.a11y.conf.js --spec ./specs/accessibility.spec.js
npx wdio run wdio.a11y.conf.js --spec ./specs/wcag-scan.spec.js
npx wdio run wdio.a11y.conf.js --spec ./specs/screenreader-tools.spec.js
```

WebdriverIO connects to the Appium server, which installs and launches
`release/mda.apk` on the emulator and then runs whichever spec(s) you asked
for. `npm run test:lint` is the exception — it's a plain Gradle build step
(`gradlew lintDebug`) and doesn't touch Appium/the emulator at all.

> `functional.spec.js` locates elements by the resource-ids visible on the
> catalog screen (`titleTV`, `cartTV`, `cartRL`, `menuIV`, ...). The add-to-cart
> and cart-screen/menu-drawer resource-ids were written from the app's known
> screen structure but not exercised end-to-end in this session — if an
> element isn't found, use `adb shell uiautomator dump` or
> `driver.getPageSource()` to check the actual resource-id/text on that screen
> and adjust the locator.

## Report layout

Every run writes into `appium-tests/reports/`, split by suite so functional
and accessibility results never overwrite each other:

```
reports/
├── functional/
│   ├── json/
│   │   └── results-<cid>.json        # @wdio/json-reporter output for functional.spec.js
│   └── html/
│       └── report.html               # aggregated wdio-html-nice-reporter report
└── a11y/
    ├── json/
    │   ├── results-<cid>.json        # one per a11y spec file (wdio json reporter)
    │   ├── accessibility-report.json # accessibility.spec.js's own summary
    │   ├── wcag-report.json          # wcag-scan.spec.js's own summary
    │   ├── screenreader-report.json  # screenreader-tools.spec.js's own summary
    │   └── android-lint-report.json  # npm run test:lint output
    └── html/
        ├── report.html               # aggregated wdio-html-nice-reporter report (3 a11y specs)
        └── android-lint-report.html  # copy of Gradle's own lint-results-debug.html
```

- The `report.html` files are generated by `wdio-html-nice-reporter`, wired up
  in [`wdio.shared.conf.js`](wdio.shared.conf.js)'s `onPrepare`/`onComplete`
  hooks — each suite's `ReportAggregator` collects that suite's per-spec JSON
  and combines it into one HTML report.
- The four `*-report.json` files under `a11y/json/` (other than
  `results-*.json`) are **not** wdio reporter output — they're written
  directly by each spec's `after()` hook (see "Reading the results" below)
  and by `scripts/run-android-lint.js`, and carry the actual issue-level
  detail (screen, element bounds, WCAG tag, etc.) that the generic wdio JSON
  report doesn't.
- Run `npm run clean:reports` to delete the whole `reports/` folder before a
  fresh run (each suite's `onPrepare` already clears its own `html/` folder
  automatically; this clears everything, including stale `json/` files from
  removed specs).

## Reading the results

- **`functional.spec.js`**: standard Mocha pass/fail per test case, in the
  console, in `reports/functional/json/results-<cid>.json`, and rendered in
  `reports/functional/html/report.html`. A failing assertion means the app's
  behavior regressed (or a locator went stale — check the resource-id note
  above).
- **`accessibility.spec.js`**: console ends with
  `=== Accessibility issues found: N ===` plus one line per issue; full data
  in `reports/a11y/json/accessibility-report.json`.
- **`wcag-scan.spec.js`**: console ends with a webview-context count and a
  native-violation count, each violation printed with its WCAG tag; full data
  in `reports/a11y/json/wcag-report.json` (`{ webview: [...], native: [...] }`).
- **`screenreader-tools.spec.js`**: console ends with a TalkBack issue count
  (one line per issue, tagged `talkback-silent-stop` /
  `talkback-unreachable-control` / `talkback-ambiguous-announcement`)
  followed by the availability status of the other three requested tools;
  full data in `reports/a11y/json/screenreader-report.json`
  (`{ screenReader: {...}, otherToolsRequested: [...] }`). Check
  `screenReader.enabled` in that report to confirm TalkBack was actually
  running for the run you're looking at.
- **Android Lint** (`npm run test:lint`): console ends with an accessibility
  issue count and one line per issue (id, severity, message, file:line); full
  data in `reports/a11y/json/android-lint-report.json`
  (`{ ran, totalIssues, accessibilityIssueCount, accessibilityIssues: [...] }`),
  plus Gradle's own full lint report (all categories, not just accessibility)
  copied to `reports/a11y/html/android-lint-report.html`.
- For the three Appium-based accessibility specs, Mocha's green checkmarks
  only mean the scan *ran* successfully — they pass even when issues are
  found. The actual result is the issue/violation count and content in the
  console summary and JSON report, not the pass/fail status. Android Lint is
  the exception: `gradlew lintDebug` exits non-zero when it finds issues at
  or above its configured severity, which is why `test:lint` is invoked as a
  separate `&&`-chained step rather than a mocha assertion.

## Troubleshooting

- **`Could not find 'aapt2.exe'`** — the Appium server was started before
  `build-tools;34.0.0` was installed, or `ANDROID_HOME` wasn't set in the
  terminal that launched `appium`. Install the build-tools package and
  restart the Appium server.
- **`'...SplashActivity' never started`** — the emulator likely isn't fully
  booted yet. Re-check `adb devices` / `adb shell getprop sys.boot_completed`
  before running the test; WebdriverIO will retry a few times but eventually
  gives up.
- **`Potentially insecure feature 'adb_shell' has not been enabled`** — the
  `before()` hook tries to read the device's screen density via `mobile: shell`
  and this is disabled by default in Appium. It's non-fatal: the test falls
  back to a hardcoded density and continues. To get exact density readings,
  start Appium with `--relaxed-security` or `--allow-insecure adb_shell`.
- **`sdkmanager`/`avdmanager` not found in Git Bash** — on Windows these ship
  as `.bat` files; call them with the `.bat` extension (`sdkmanager.bat`) or
  run from PowerShell/cmd instead.
- **First TalkBack enable shows an "Allow Android Accessibility Suite to
  send you notifications?" system dialog** that steals focus from the app —
  `enableTalkBack()` in `utils/talkback.js` pre-grants
  `POST_NOTIFICATIONS` to TalkBack's package specifically to avoid this. If
  you still hit it (e.g. on a different Android version/AVD image), the spec
  will silently evaluate the wrong screen; dismiss the dialog manually once
  and it won't reappear on later runs on the same AVD.
- **`screenreader-tools.spec.js` skips entirely** — this happens if
  `com.google.android.marvin.talkback` isn't installed on the device/AVD
  image (`before()` calls `this.skip()` in that case). Use an AVD system
  image that includes Google APIs/Play services; the plain AOSP images don't
  ship TalkBack.
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
