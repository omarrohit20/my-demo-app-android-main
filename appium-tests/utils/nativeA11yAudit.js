const { parseStringPromise } = require('xml2js');

const MIN_TOUCH_TARGET_DP = 48;

// Maps our native-tree checks onto the closest WCAG 2.1 success criteria.
// axe-core cannot run against a native Android accessibility tree (it only
// understands the DOM), so this is the practical substitute for native
// screens: same shape as an axe violation (id, wcag tag, impact, nodes).
const RULES = {
  'name-role-value': {
    wcag: 'WCAG 2.1 SC 4.1.2 (Name, Role, Value)',
    impact: 'critical',
    help: 'Interactive elements must have an accessible name a screen reader can announce.',
  },
  'non-text-content': {
    wcag: 'WCAG 2.1 SC 1.1.1 (Non-text Content)',
    impact: 'serious',
    help: 'Icon-only controls must expose a text alternative via content-desc.',
  },
  'target-size': {
    wcag: 'WCAG 2.1 SC 2.5.5 (Target Size)',
    impact: 'moderate',
    help: `Touch targets should be at least ${MIN_TOUCH_TARGET_DP}x${MIN_TOUCH_TARGET_DP}dp.`,
  },
};

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

function makeViolation(ruleId, screenName, attrs, detail) {
  const rule = RULES[ruleId];
  return {
    id: ruleId,
    wcag: rule.wcag,
    impact: rule.impact,
    help: rule.help,
    screen: screenName,
    nodes: [
      {
        class: attrs.class,
        resourceId: attrs['resource-id'] || null,
        bounds: attrs.bounds,
        detail,
      },
    ],
  };
}

async function auditNativeScreen(driver, screenName, density) {
  const source = await driver.getPageSource();
  const parsed = await parseStringPromise(source);
  const root = Object.values(parsed)[0];
  const violations = [];

  walk(root, (attrs) => {
    const clickable = attrs.clickable === 'true' || attrs['long-clickable'] === 'true';
    const text = (attrs.text || '').trim();
    const desc = (attrs['content-desc'] || '').trim();
    const bounds = parseBounds(attrs.bounds);

    if (clickable && !text && !desc) {
      violations.push(
        makeViolation(
          'name-role-value',
          screenName,
          attrs,
          'Clickable element has no text and no content-desc; a screen reader cannot announce it.'
        )
      );
    }

    if ((attrs.class || '').endsWith('ImageView') && clickable && !desc) {
      violations.push(
        makeViolation(
          'non-text-content',
          screenName,
          attrs,
          'Clickable ImageView has no content-desc (icon button without an accessible name).'
        )
      );
    }

    if (clickable && bounds && density) {
      const widthDp = bounds.width / density;
      const heightDp = bounds.height / density;
      if (widthDp < MIN_TOUCH_TARGET_DP || heightDp < MIN_TOUCH_TARGET_DP) {
        violations.push(
          makeViolation(
            'target-size',
            screenName,
            attrs,
            `Touch target is ${widthDp.toFixed(0)}x${heightDp.toFixed(0)}dp, below the ${MIN_TOUCH_TARGET_DP}dp minimum.`
          )
        );
      }
    }
  });

  return violations;
}

async function getDeviceDensity(driver, fallback = 2.625) {
  try {
    const output = await driver.execute('mobile: shell', {
      command: 'wm',
      args: ['density'],
    });
    const m = /Physical density: (\d+)/.exec(output);
    return m ? Number(m[1]) / 160 : fallback;
  } catch (e) {
    return fallback;
  }
}

module.exports = { auditNativeScreen, getDeviceDensity, MIN_TOUCH_TARGET_DP, RULES };
