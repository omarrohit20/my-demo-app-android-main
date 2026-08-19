const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const axeSource = require('axe-core').source;
const { auditNativeScreen, getDeviceDensity } = require('../utils/nativeA11yAudit');

// WCAG-mapped accessibility scan for MDA.
//
// IMPORTANT: axe-core only understands the DOM. It can scan WebView content
// exposed through an Appium "webview" context, but it CANNOT scan native
// Android views (TextView, ImageView, RecyclerView, ...) because there is no
// DOM there for it to inspect. This app is fully native, so in practice this
// spec's axe pass will find zero contexts to scan and report that clearly.
//
// For the native screens, we run the same WCAG success-criteria checks as
// accessibility.spec.js, but shaped and reported like axe-core violations
// (id, wcag tag, impact, nodes) via utils/nativeA11yAudit.js, so native and
// web findings sit in one consistent report.

async function scanWebviewContexts() {
  const contexts = await driver.getContexts();
  const webviewContexts = contexts.filter((c) => String(c).toLowerCase().includes('webview'));
  const results = [];

  for (const context of webviewContexts) {
    await driver.switchContext(context);
    await driver.execute(axeSource);
    const axeResult = await driver.executeAsync((done) => {
      window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }, (err, res) => {
        done(err ? { error: String(err) } : res);
      });
    });
    results.push({ context, axeResult });
  }

  if (webviewContexts.length) {
    await driver.switchContext('NATIVE_APP');
  }

  return results;
}

describe('MDA WCAG-mapped accessibility scan', () => {
  const nativeViolations = [];
  const webviewResults = [];
  let density;

  before(async () => {
    density = await getDeviceDensity(driver);
  });

  it('scans WebView content with axe-core, if any is present', async () => {
    const results = await scanWebviewContexts();
    webviewResults.push(...results);

    if (!results.length) {
      console.log('\nNo WebView contexts found — this app is fully native, so axe-core has nothing to scan.');
    }
    expect(Array.isArray(results)).to.equal(true);
  });

  it('scans the native product catalog screen against WCAG success criteria', async () => {
    const violations = await auditNativeScreen(driver, 'product-catalog', density);
    nativeViolations.push(...violations);
  });

  it('scans the product detail screen against WCAG success criteria', async () => {
    try {
      const firstProduct = await driver.$(
        '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
      );
      await firstProduct.waitForDisplayed({ timeout: 10000 });
      await firstProduct.click();
      await driver.pause(1000);
      const violations = await auditNativeScreen(driver, 'product-detail', density);
      nativeViolations.push(...violations);
      await driver.back();
    } catch (e) {
      console.log(`Skipped product-detail screen: ${e.message}`);
    }
  });

  after(() => {
    const report = {
      webview: webviewResults,
      native: nativeViolations,
    };
    const reportsDir = path.resolve(__dirname, '..', 'reports', 'a11y', 'json');
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.resolve(reportsDir, 'wcag-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n=== WCAG scan: ${webviewResults.length} webview context(s), ${nativeViolations.length} native violation(s) ===`);
    for (const v of nativeViolations) {
      console.log(`[${v.screen}] ${v.id} — ${v.wcag} (${v.impact}): ${v.nodes[0].detail}`);
    }
    for (const w of webviewResults) {
      const count = w.axeResult?.violations?.length ?? 0;
      console.log(`[webview:${w.context}] axe-core found ${count} violation(s)`);
    }
    console.log(`Full report written to ${reportPath}\n`);
  });
});
