const { parseStringPromise } = require('xml2js');
const { expect } = require('chai');

const MIN_TOUCH_TARGET_DP = 48;

function parseBounds(boundsStr) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(boundsStr || '');
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { width: x2 - x1, height: y2 - y1 };
}

function walk(node, cb) {
  if (!node) return;
  cb(node.$ || {});
  const children = Object.keys(node).filter((k) => k !== '$');
  for (const key of children) {
    const list = Array.isArray(node[key]) ? node[key] : [node[key]];
    for (const child of list) walk(child, cb);
  }
}

async function auditScreen(driver, screenName, density, issues) {
  const source = await driver.getPageSource();
  const parsed = await parseStringPromise(source);
  const root = Object.values(parsed)[0];

  walk(root, (attrs) => {
    const clickable = attrs.clickable === 'true' || attrs['long-clickable'] === 'true';
    const text = (attrs.text || '').trim();
    const desc = (attrs['content-desc'] || '').trim();
    const cls = attrs.class || '';
    const bounds = parseBounds(attrs.bounds);

    if (clickable && !text && !desc) {
      issues.push({
        screen: screenName,
        type: 'missing-accessible-label',
        class: cls,
        bounds: attrs.bounds,
        detail: 'Clickable element has no text and no content-desc; screen readers cannot announce it.',
      });
    }

    if (clickable && bounds && density) {
      const widthDp = bounds.width / density;
      const heightDp = bounds.height / density;
      if (widthDp < MIN_TOUCH_TARGET_DP || heightDp < MIN_TOUCH_TARGET_DP) {
        issues.push({
          screen: screenName,
          type: 'small-touch-target',
          class: cls,
          bounds: attrs.bounds,
          detail: `Touch target is ${widthDp.toFixed(0)}x${heightDp.toFixed(0)}dp, below the ${MIN_TOUCH_TARGET_DP}dp minimum.`,
        });
      }
    }

    if ((attrs.class || '').endsWith('ImageView') && !desc && clickable) {
      issues.push({
        screen: screenName,
        type: 'unlabeled-image-control',
        class: cls,
        bounds: attrs.bounds,
        detail: 'Clickable ImageView has no content-desc (icon button without an accessible name).',
      });
    }
  });
}

describe('MDA accessibility audit', () => {
  const issues = [];
  let density = 2.625; // fallback; overwritten from device metrics below

  before(async () => {
    try {
      const displayDensity = await driver.execute('mobile: shell', {
        command: 'wm',
        args: ['density'],
      });
      const m = /Physical density: (\d+)/.exec(displayDensity);
      if (m) density = Number(m[1]) / 160;
    } catch (e) {
      // keep fallback density
    }
  });

  it('audits the initial screen', async () => {
    await auditScreen(driver, 'initial', density, issues);
    expect(await driver.getPageSource()).to.be.a('string');
  });

  it('audits reachable screens via bottom navigation / menu', async () => {
    const navCandidates = await driver.$$(
      '//android.widget.FrameLayout[@clickable="true"] | //android.view.ViewGroup[@clickable="true"]'
    );
    let visited = 0;
    for (const el of navCandidates) {
      if (visited >= 6) break;
      try {
        if (await el.isDisplayed()) {
          await el.click();
          await driver.pause(1200);
          const label = (await el.getAttribute('content-desc')) || (await el.getAttribute('text')) || `nav-${visited}`;
          await auditScreen(driver, label, density, issues);
          visited++;
        }
      } catch (e) {
        // element may have gone stale after navigation; skip
      }
    }
  });

  after(() => {
    const fs = require('fs');
    const path = require('path');
    const reportsDir = path.resolve(__dirname, '..', 'reports', 'a11y', 'json');
    fs.mkdirSync(reportsDir, { recursive: true });
    const summaryPath = path.resolve(reportsDir, 'accessibility-report.json');
    fs.writeFileSync(summaryPath, JSON.stringify(issues, null, 2));
    console.log(`\n=== Accessibility issues found: ${issues.length} ===`);
    for (const issue of issues) {
      console.log(`[${issue.screen}] ${issue.type} (${issue.class}) @ ${issue.bounds}: ${issue.detail}`);
    }
    console.log(`Full report written to ${summaryPath}\n`);
  });
});
