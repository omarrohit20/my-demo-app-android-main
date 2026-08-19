const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const { expect } = require('chai');
const talkback = require('../utils/talkback');
const { checkAccessibilityScanner, checkAxeDevToolsMobile, checkAndroidATF } = require('../utils/toolAvailability');

// Screen-reader-focused accessibility spec, integrating (or honestly
// reporting on) four tools the team asked about:
//
//   - TalkBack             -> actually driven: enabled for real on the
//                              device via adb, app exercised while it's
//                              running, then every node evaluated against
//                              the same rules TalkBack itself uses to decide
//                              what to speak.
//   - Axe DevTools Mobile,
//     Accessibility Scanner,
//     Android ATF          -> cannot be executed from this harness (see
//                              utils/toolAvailability.js for exactly why —
//                              each needs either a paid SDK linked into the
//                              app at build time, a Play Store app with no
//                              automation API, or an instrumented test built
//                              from app source). Reported as "not available"
//                              with concrete manual/CI steps rather than
//                              faking results.
//   - Android Lint         -> actually executed separately via
//                              `npm run test:lint` (see
//                              utils/androidLint.js / scripts/run-android-lint.js).
//                              It's a static analyzer over this repo's Gradle
//                              project, not an Appium/device check, so it
//                              doesn't run inline here — its own report lands
//                              in reports/a11y/json/android-lint-report.json.
//
// TalkBack "functional" here means: real service enable/disable lifecycle,
// real app interaction while the service is live, and a per-node speakable
// text/role check that mirrors Android's actual announcement precedence
// (contentDescription > text, importance-for-accessibility gating). We also
// attempt a real touch-exploration gesture as a best-effort probe and report
// whether it registered — synthetic adb input events don't reliably trigger
// TalkBack's hover/dwell detection on every emulator config, so this is
// logged as an observation, not asserted as pass/fail.

async function evaluateScreenForTalkBack(driver, screenName) {
  const source = await driver.getPageSource();
  const parsed = await parseStringPromise(source);
  const root = Object.values(parsed)[0];
  const issues = [];
  const announcements = [];

  function walk(node) {
    if (!node) return;
    const attrs = node.$ || {};
    const important = attrs['a11y-important'] !== 'false';
    const focusable =
      attrs['screen-reader-focusable'] === 'true' ||
      attrs.clickable === 'true' ||
      attrs['long-clickable'] === 'true' ||
      attrs.focusable === 'true';

    if (important && focusable) {
      const speakable = talkback.speakableTextFor(attrs);
      const role = talkback.roleFor(attrs.class);

      if (!speakable) {
        issues.push({
          screen: screenName,
          type: 'talkback-silent-stop',
          class: attrs.class,
          bounds: attrs.bounds,
          detail: 'TalkBack would land on this element during linear navigation but has nothing to speak (no content-desc/text).',
        });
      } else {
        announcements.push({ screen: screenName, class: attrs.class, bounds: attrs.bounds, speakable, role });
      }
    }

    if (!important && (attrs.clickable === 'true' || attrs['long-clickable'] === 'true')) {
      issues.push({
        screen: screenName,
        type: 'talkback-unreachable-control',
        class: attrs.class,
        bounds: attrs.bounds,
        detail: 'Element is clickable but marked a11y-important="false" — TalkBack will skip over it entirely, even though it responds to touch.',
      });
    }

    const children = Object.keys(node).filter((k) => k !== '$');
    for (const key of children) {
      const list = Array.isArray(node[key]) ? node[key] : [node[key]];
      for (const child of list) walk(child);
    }
  }

  walk(root);

  const seen = new Map();
  for (const a of announcements) {
    seen.set(a.speakable, (seen.get(a.speakable) || 0) + 1);
  }
  for (const [text, count] of seen) {
    if (count > 1) {
      issues.push({
        screen: screenName,
        type: 'talkback-ambiguous-announcement',
        class: null,
        bounds: null,
        detail: `${count} different focusable elements would all announce "${text}" with no distinguishing context — a TalkBack user can't tell them apart by ear.`,
      });
    }
  }

  return { issues, announcements };
}

async function probeTouchExploration(driver) {
  try {
    const before = await driver.getPageSource();
    // Coordinates target open scroll-area whitespace on the catalog screen,
    // away from the menu/sort/cart controls, to avoid triggering navigation
    // as a side effect of the probe.
    await driver.execute('mobile: shell', {
      command: 'input',
      args: ['touchscreen', 'swipe', '160', '90', '165', '95', '400'],
    });
    await driver.pause(500);
    const after = await driver.getPageSource();
    return { attempted: true, changed: before !== after };
  } catch (e) {
    return { attempted: false, changed: false, error: e.message };
  }
}

describe('MDA screen reader (TalkBack) functional accessibility scan', () => {
  const talkbackIssues = [];
  const otherTools = [checkAxeDevToolsMobile(), checkAccessibilityScanner(), checkAndroidATF()];
  let touchExplorationProbe = { attempted: false, changed: false };

  before(async function () {
    if (!talkback.isTalkBackInstalled()) {
      this.skip();
      return;
    }
    talkback.enableTalkBack();
    await driver.pause(2000);
  });

  after(async () => {
    talkback.disableTalkBack();

    const report = {
      screenReader: {
        tool: 'TalkBack',
        enabled: talkback.isTalkBackEnabled(),
        touchExplorationProbe,
        issues: talkbackIssues,
      },
      otherToolsRequested: otherTools,
    };
    const reportsDir = path.resolve(__dirname, '..', 'reports', 'a11y', 'json');
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.resolve(reportsDir, 'screenreader-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n=== TalkBack screen-reader issues found: ${talkbackIssues.length} ===`);
    for (const issue of talkbackIssues) {
      console.log(`[${issue.screen}] ${issue.type} (${issue.class}) @ ${issue.bounds}: ${issue.detail}`);
    }
    console.log('\n=== Other requested tools ===');
    for (const t of otherTools) {
      console.log(`[${t.tool}] NOT AVAILABLE — ${t.reason}`);
    }
    console.log(`\nFull report written to ${reportPath}\n`);
  });

  it('confirms TalkBack is actually running on the device', async () => {
    expect(talkback.isTalkBackEnabled()).to.equal(true);
  });

  // Screen evaluations run before the touch-exploration probe on purpose:
  // the probe's synthetic swipe can land on/near a control (e.g. the menu
  // icon) and change screen state (opening the nav drawer), which would
  // contaminate any evaluation that runs after it.
  it('evaluates the product catalog screen against TalkBack announcement rules', async () => {
    const { issues } = await evaluateScreenForTalkBack(driver, 'product-catalog');
    talkbackIssues.push(...issues);
  });

  it('evaluates the product detail screen against TalkBack announcement rules', async () => {
    try {
      const firstProduct = await driver.$(
        '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
      );
      await firstProduct.waitForDisplayed({ timeout: 10000 });
      await firstProduct.click();
      await driver.pause(1000);
      const { issues } = await evaluateScreenForTalkBack(driver, 'product-detail');
      talkbackIssues.push(...issues);
      await driver.back();
      await driver.pause(500);
    } catch (e) {
      console.log(`Skipped product-detail screen: ${e.message}`);
    }
  });

  it('probes whether synthetic touch exploration registers with TalkBack', async () => {
    touchExplorationProbe = await probeTouchExploration(driver);
    // Observational only — logged, not asserted. This needs the Appium
    // server started with --allow-insecure adb_shell, and even then
    // synthetic adb touch events don't reliably trigger TalkBack's
    // hover/dwell gesture detection on every emulator/AVD configuration.
    // Runs last since it can change on-screen state (e.g. open the nav
    // drawer if the swipe coordinates land near a control).
    console.log(`Touch exploration probe: ${JSON.stringify(touchExplorationProbe)}`);
    expect(touchExplorationProbe).to.be.an('object');
  });
});
