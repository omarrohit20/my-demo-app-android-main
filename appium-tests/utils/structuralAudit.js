const { parseStringPromise } = require('xml2js');

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

/**
 * Structural sweep of the current screen's accessibility node tree: missing
 * labels, unlabeled icon controls, undersized touch targets. Appends found
 * issues to the `issues` accumulator, tagged with `screenName`.
 */
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

    if (cls.endsWith('ImageView') && !desc && clickable) {
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

module.exports = { auditScreen, MIN_TOUCH_TARGET_DP };
