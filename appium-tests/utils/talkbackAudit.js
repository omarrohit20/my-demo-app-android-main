const { parseStringPromise } = require('xml2js');
const talkback = require('./talkback');

/**
 * Evaluates the current screen against TalkBack's real announcement rules
 * (speakable text precedence, a11y-important gating, linear-navigation
 * reachability) and appends found issues to the `issues` accumulator.
 * Returns per-node announcement data too, used to detect ambiguous
 * (identically-announced) elements across the same screen.
 */
async function evaluateScreenForTalkBack(driver, screenName, issues) {
  const source = await driver.getPageSource();
  const parsed = await parseStringPromise(source);
  const root = Object.values(parsed)[0];
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

  return announcements;
}

async function probeTouchExploration(driver) {
  try {
    const before = await driver.getPageSource();
    // Coordinates target open scroll-area whitespace, away from menu/sort/
    // cart controls, to avoid triggering navigation as a side effect.
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

module.exports = { evaluateScreenForTalkBack, probeTouchExploration };
