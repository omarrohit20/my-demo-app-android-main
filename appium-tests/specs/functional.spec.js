const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const axeSource = require('axe-core').source;
const talkback = require('../utils/talkback');
const { auditScreen } = require('../utils/structuralAudit');
const { getDeviceDensity } = require('../utils/nativeA11yAudit');
const { evaluateScreenForTalkBack, probeTouchExploration } = require('../utils/talkbackAudit');
const { checkAccessibilityScanner, checkAxeDevToolsMobile, checkAndroidATF } = require('../utils/toolAvailability');
const { generateA11yHtmlReport } = require('../utils/generateA11yHtmlReport');
const { generateA11yScreenshotReport } = require('../utils/generateA11yScreenshotReport');

// Functional smoke test for the Sauce Labs "My Demo App" (mda.apk), covering
// every reachable flow: browse/sort -> product detail -> cart -> login ->
// checkout (shipping + payment) -> order confirmation -> nav-drawer screens
// (WebView, QR Code Scanner, Geo Location, Drawing, About) -> logout.
//
// Accessibility scanning is NOT a separate spec/traversal. When A11Y_SCAN=true
// (set by wdio.a11y.conf.js), every `it()` below is followed by a real
// accessibility audit of whatever screen that step just navigated to —
// structural checks and TalkBack evaluation, the same checks previously run
// by their own specs (accessibility.spec.js / screenreader-tools.spec.js),
// now riding along on the app states this functional flow actually produces
// instead of a separate synthetic "click up to 6 things" traversal. Plain
// `npm run test:functional` runs with A11Y_SCAN unset, so it does none of
// this extra work.
//
// WCAG/axe-core scanning only ever runs against a WebView's real DOM
// (`scanWebviewContexts()`, called when the WebView screen loads) — there is
// no synthetic "native WCAG" mapping layered on top of the structural sweep.
// axe-core cannot inspect native Android views at all, so pretending
// otherwise by reshaping structural findings into axe-violation-looking
// objects would misattribute them to a WCAG/axe scan that never actually ran
// against that screen.
const A11Y_SCAN = process.env.A11Y_SCAN === 'true';

const CREDENTIALS_TIMEOUT = 15000;

describe(`MDA functional workflows${A11Y_SCAN ? ' (+ accessibility scan)' : ''}`, () => {
  let density;
  let talkbackAvailable = false;
  const structuralIssues = [];
  const webviewResults = [];
  const talkbackIssues = [];
  const screenshots = {};
  let touchExplorationProbe = { attempted: false, changed: false };

  async function scanWebviewContexts(screenName) {
    const contexts = await driver.getContexts();
    const webviewContexts = contexts.filter((c) => String(c).toLowerCase().includes('webview'));

    for (const context of webviewContexts) {
      await driver.switchContext(context);
      await driver.execute(axeSource);
      const axeResult = await driver.executeAsync((done) => {
        window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }, (err, res) => {
          done(err ? { error: String(err) } : res);
        });
      });
      webviewResults.push({ screen: screenName, context, axeResult });
    }

    if (webviewContexts.length) {
      await driver.switchContext('NATIVE_APP');
    }
  }

  // Tags every issue newly pushed into `accumulator` (from index `startLen`
  // onward) with which tool/check produced it, so the screenshot report can
  // later group multiple tools' findings for the same element into one row
  // instead of duplicating it per tool.
  function tagSource(accumulator, startLen, source) {
    for (let i = startLen; i < accumulator.length; i++) {
      accumulator[i].source = source;
    }
  }

  // Runs the full accessibility audit against whatever screen is currently
  // on-device. Called explicitly after each navigation step (not from a
  // generic afterEach) so every report entry is tagged with a meaningful,
  // human-authored screen name instead of a raw mocha test title.
  async function auditCurrentScreen(screenName) {
    if (!A11Y_SCAN) return;
    if (!screenshots[screenName]) {
      try {
        screenshots[screenName] = await driver.takeScreenshot();
      } catch (e) {
        console.log(`Screenshot capture failed for screen "${screenName}": ${e.message}`);
      }
    }
    try {
      const structStart = structuralIssues.length;
      await auditScreen(driver, screenName, density, structuralIssues);
      tagSource(structuralIssues, structStart, 'Structural Sweep');

      if (talkbackAvailable) {
        const talkbackStart = talkbackIssues.length;
        await evaluateScreenForTalkBack(driver, screenName, talkbackIssues);
        tagSource(talkbackIssues, talkbackStart, 'TalkBack');
      }
    } catch (e) {
      console.log(`a11y scan skipped for screen "${screenName}": ${e.message}`);
    }
  }

  before(async function () {
    if (!A11Y_SCAN) return;
    density = await getDeviceDensity(driver);
    talkbackAvailable = talkback.isTalkBackInstalled();
    if (talkbackAvailable) {
      talkback.enableTalkBack();
      await driver.pause(2000);
    }
  });

  after(async () => {
    if (!A11Y_SCAN) return;
    if (talkbackAvailable) talkback.disableTalkBack();

    const reportsDir = path.resolve(__dirname, '..', 'reports', 'a11y', 'json');
    fs.mkdirSync(reportsDir, { recursive: true });

    fs.writeFileSync(
      path.resolve(reportsDir, 'accessibility-report.json'),
      JSON.stringify(structuralIssues, null, 2)
    );

    // WCAG/axe-core coverage only ever comes from real axe-core runs against
    // WebView contexts (`scanWebviewContexts()`) — there is no "native"
    // section synthesized from the structural sweep. See
    // accessibility-report.json for native/structural findings instead.
    fs.writeFileSync(path.resolve(reportsDir, 'wcag-report.json'), JSON.stringify({ webview: webviewResults }, null, 2));

    const otherToolsRequested = [checkAxeDevToolsMobile(), checkAccessibilityScanner(), checkAndroidATF()];
    const screenReader = {
      tool: 'TalkBack',
      enabled: talkbackAvailable && talkback.isTalkBackEnabled(),
      touchExplorationProbe,
      issues: talkbackIssues,
    };
    fs.writeFileSync(
      path.resolve(reportsDir, 'screenreader-report.json'),
      JSON.stringify({ screenReader, otherToolsRequested }, null, 2)
    );

    // Deliberately NOT wdio's own mocha/html-nice reporters (disabled for
    // this suite via includeMochaReports: false in wdio.a11y.conf.js) — this
    // is an accessibility-findings report, not a functional test pass/fail
    // report, so it's generated straight from the accumulators above.
    const htmlReportsDir = path.resolve(__dirname, '..', 'reports', 'a11y', 'html');
    fs.mkdirSync(htmlReportsDir, { recursive: true });
    fs.writeFileSync(
      path.resolve(htmlReportsDir, 'report.html'),
      generateA11yHtmlReport({
        structuralIssues,
        webviewResults,
        screenReader,
        otherToolsRequested,
        generatedAt: new Date().toISOString(),
      })
    );

    const screenshotReportPath = path.resolve(htmlReportsDir, 'screenshot-report.html');
    fs.writeFileSync(
      screenshotReportPath,
      generateA11yScreenshotReport({
        screenshots,
        structuralIssues,
        talkbackIssues,
        webviewResults,
        generatedAt: new Date().toISOString(),
      })
    );

    console.log('\n=== Accessibility scan (driven by the functional test flow) ===');
    console.log(`Structural issues: ${structuralIssues.length}`);
    console.log(`WCAG/axe-core violations (WebView contexts only): ${webviewResults.reduce((n, w) => n + ((w.axeResult && w.axeResult.violations) || []).length, 0)}`);
    console.log(`WebView (axe-core) contexts scanned: ${webviewResults.length}`);
    console.log(
      `TalkBack issues: ${talkbackIssues.length} (TalkBack ${talkbackAvailable ? 'ran' : 'not installed — skipped'})`
    );
    console.log(`Screenshots captured: ${Object.keys(screenshots).length}`);
    console.log(`JSON reports written to ${reportsDir}`);
    console.log(`HTML reports written to ${htmlReportsDir} (report.html, screenshot-report.html)\n`);
  });

  describe('Product catalog', () => {
    it('shows the product catalog on launch', async () => {
      const catalogTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/productTV');
      await catalogTitle.waitForDisplayed({ timeout: CREDENTIALS_TIMEOUT });
      expect(await catalogTitle.getText()).to.equal('Products');

      const productList = await driver.$('id=com.saucelabs.mydemoapp.android:id/productRV');
      expect(await productList.isDisplayed()).to.be.true;
      await auditCurrentScreen('product-catalog');
    });

    it('sorts the catalog by name and by price', async () => {
      const sortOptions = [
        { id: 'nameAscCL', screen: 'catalog-sort-name-asc' },
        { id: 'nameDesCL', screen: 'catalog-sort-name-desc' },
        { id: 'priceAscCL', screen: 'catalog-sort-price-asc' },
        { id: 'priceDesCL', screen: 'catalog-sort-price-desc' },
      ];

      for (const option of sortOptions) {
        const sortIcon = await driver.$('id=com.saucelabs.mydemoapp.android:id/sortIV');
        await sortIcon.waitForDisplayed({ timeout: 10000 });
        await sortIcon.click();

        const sortChoice = await driver.$(`id=com.saucelabs.mydemoapp.android:id/${option.id}`);
        await sortChoice.waitForDisplayed({ timeout: 10000 });
        await sortChoice.click();

        const productList = await driver.$('id=com.saucelabs.mydemoapp.android:id/productRV');
        await productList.waitForDisplayed({ timeout: 10000 });
        await auditCurrentScreen(option.screen);
      }
    });
  });

  describe('Product detail & cart', () => {
    it('opens a product detail screen and adjusts the quantity', async () => {
      const firstProduct = await driver.$(
        '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
      );
      await firstProduct.waitForDisplayed({ timeout: CREDENTIALS_TIMEOUT });
      await firstProduct.click();

      const plusButton = await driver.$('id=com.saucelabs.mydemoapp.android:id/plusIV');
      await plusButton.waitForDisplayed({ timeout: 10000 });
      await plusButton.click();
      await plusButton.click();

      const quantity = await driver.$('id=com.saucelabs.mydemoapp.android:id/noTV');
      expect(await quantity.getText()).to.equal('3');
      await auditCurrentScreen('product-detail');
    });

    it('adds the product to the cart and updates the cart badge', async () => {
      const addToCartBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartBt');
      await addToCartBtn.waitForDisplayed({ timeout: CREDENTIALS_TIMEOUT });
      await addToCartBtn.click();

      const cartBadge = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartTV');
      await cartBadge.waitForDisplayed({ timeout: 10000 });
      expect(await cartBadge.getText()).to.match(/^[1-9]\d*$/);
      await auditCurrentScreen('product-catalog-after-add-to-cart');
    });

    it('shows the added product in the cart screen', async () => {
      const cartIcon = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartRL');
      await cartIcon.waitForDisplayed({ timeout: 10000 });
      await cartIcon.click();

      const cartScreenTitle = await driver.$('//android.widget.TextView[@text="My Cart"]');
      await cartScreenTitle.waitForDisplayed({ timeout: 10000 });

      const cartItem = await driver.$(
        '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
      );
      expect(await cartItem.isDisplayed()).to.be.true;
      await auditCurrentScreen('cart');
    });
  });

  describe('Checkout', () => {
    it('requires login before checkout', async () => {
      const checkoutBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartBt');
      await checkoutBtn.waitForDisplayed({ timeout: 10000 });
      await checkoutBtn.click();

      const loginTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/loginTV');
      await loginTitle.waitForDisplayed({ timeout: 10000 });
      expect(await loginTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('login');
    });

    it('logs in with a demo account', async () => {
      const savedUsername = await driver.$('id=com.saucelabs.mydemoapp.android:id/username1TV');
      await savedUsername.waitForDisplayed({ timeout: 10000 });
      await savedUsername.click();

      const loginBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/loginBtn');
      await loginBtn.click();

      const checkoutTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/checkoutTitleTV');
      await checkoutTitle.waitForDisplayed({ timeout: 10000 });
      expect(await checkoutTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('checkout-shipping-info');
    });

    it('submits shipping information', async () => {
      const fields = [
        ['fullNameET', 'Jane Doe'],
        ['address1ET', '123 Market Street'],
        ['cityET', 'San Francisco'],
        ['zipET', '94103'],
        ['countryET', 'USA'],
      ];
      for (const [id, value] of fields) {
        const field = await driver.$(`id=com.saucelabs.mydemoapp.android:id/${id}`);
        await field.waitForDisplayed({ timeout: 10000 });
        await field.setValue(value);
      }

      const paymentBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/paymentBtn');
      await paymentBtn.click();

      const paymentTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/enterPaymentTitleTV');
      await paymentTitle.waitForDisplayed({ timeout: 10000 });
      expect(await paymentTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('checkout-payment');
    });

    it('submits payment information and completes the order', async () => {
      const billingAddressSameCB = await driver.$('id=com.saucelabs.mydemoapp.android:id/billingAddressCB');
      await billingAddressSameCB.waitForDisplayed({ timeout: 10000 });
      await billingAddressSameCB.click();

      const fields = [
        ['nameET', 'Jane Doe'],
        ['cardNumberET', '4111111111111111'],
        ['expirationDateET', '12/2030'],
        ['securityCodeET', '123'],
      ];
      for (const [id, value] of fields) {
        const field = await driver.$(`id=com.saucelabs.mydemoapp.android:id/${id}`);
        await field.waitForDisplayed({ timeout: 10000 });
        await field.setValue(value);
      }

      const paymentBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/paymentBtn');
      await paymentBtn.click();

      const completeTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/completeTV');
      await completeTitle.waitForDisplayed({ timeout: 10000 });
      expect(await completeTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('checkout-complete');
    });

    it('returns to the catalog from the order confirmation', async () => {
      const backToShoppingBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/shoopingBt');
      await backToShoppingBtn.waitForDisplayed({ timeout: 10000 });
      await backToShoppingBtn.click();

      const catalogTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/productTV');
      await catalogTitle.waitForDisplayed({ timeout: 10000 });
      expect(await catalogTitle.getText()).to.equal('Products');
      await auditCurrentScreen('product-catalog-after-order');
    });
  });

  describe('Navigation drawer', () => {
    async function openMenuItem(itemText) {
      const menuIcon = await driver.$('id=com.saucelabs.mydemoapp.android:id/menuIV');
      await menuIcon.waitForDisplayed({ timeout: 10000 });
      await menuIcon.click();

      const menuEntry = await driver.$(`//android.widget.TextView[@text="${itemText}"]`);
      await menuEntry.waitForDisplayed({ timeout: 10000 });
      await menuEntry.click();
    }

    it('opens the WebView screen from the menu', async () => {
      await openMenuItem('WebView');

      const urlField = await driver.$('id=com.saucelabs.mydemoapp.android:id/urlET');
      await urlField.waitForDisplayed({ timeout: 10000 });
      await urlField.setValue('https://www.saucelabs.com');
      await auditCurrentScreen('webview-address-entry');

      const goBtn = await driver.$('id=com.saucelabs.mydemoapp.android:id/goBtn');
      await goBtn.click();

      const webView = await driver.$('id=com.saucelabs.mydemoapp.android:id/webView');
      await webView.waitForDisplayed({ timeout: 15000 });
      expect(await webView.isDisplayed()).to.be.true;
      await auditCurrentScreen('webview-loaded');
      if (A11Y_SCAN) {
        await scanWebviewContexts('webview-loaded');
      }

      await driver.back();
    });

    it('opens the QR Code Scanner screen from the menu', async () => {
      await openMenuItem('QR Code Scanner');

      const qrTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/qrCodeTV');
      await qrTitle.waitForDisplayed({ timeout: 10000 });
      expect(await qrTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('qr-code-scanner');
    });

    it('opens the Geo Location screen from the menu', async () => {
      await openMenuItem('Geo Location');

      const locationTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/locationTV');
      await locationTitle.waitForDisplayed({ timeout: 10000 });
      expect(await locationTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('geo-location');
    });

    it('opens the Drawing screen from the menu', async () => {
      await openMenuItem('Drawing');

      const drawingTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/drawingTV');
      await drawingTitle.waitForDisplayed({ timeout: 10000 });
      expect(await drawingTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('drawing');
    });

    it('opens the About screen from the menu', async () => {
      await openMenuItem('About');

      const aboutTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/aboutTV');
      await aboutTitle.waitForDisplayed({ timeout: 10000 });
      expect(await aboutTitle.isDisplayed()).to.be.true;
      await auditCurrentScreen('about');
    });

    it('probes whether synthetic touch exploration registers with TalkBack', async function () {
      if (!A11Y_SCAN || !talkbackAvailable) return this.skip();
      // Observational only — logged, not asserted. Needs Appium started with
      // --allow-insecure adb_shell, and even then synthetic adb touch events
      // don't reliably trigger TalkBack's hover/dwell detection on every
      // emulator/AVD configuration.
      touchExplorationProbe = await probeTouchExploration(driver);
      expect(touchExplorationProbe).to.be.an('object');
    });

    it('logs out from the menu', async () => {
      await openMenuItem('Log Out');

      const logoutConfirmBtn = await driver.$('//*[@text="LOGOUT"]');
      await logoutConfirmBtn.waitForDisplayed({ timeout: 10000 });
      await logoutConfirmBtn.click();

      const catalogTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/productTV');
      await catalogTitle.waitForDisplayed({ timeout: 10000 });
      expect(await catalogTitle.getText()).to.equal('Products');
      await auditCurrentScreen('product-catalog-after-logout');
    });
  });
});
