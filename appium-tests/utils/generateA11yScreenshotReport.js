// Maps each check's own issue-type vocabulary onto one canonical category,
// so the same underlying element flagged by more than one native check (e.g.
// the structural sweep's "missing-accessible-label" and TalkBack's
// "talkback-silent-stop" — both are "this control has no accessible name")
// collapses into a single row instead of two near-identical ones. This only
// covers the native checks (structural sweep + TalkBack) — WCAG/axe-core
// findings only ever come from a real axe-core scan of a WebView's DOM
// (see the webview handling below), so there's no native/axe overlap to
// dedupe in the first place.
const CATEGORY_BY_TYPE = {
  'missing-accessible-label': 'no-accessible-name',
  'talkback-silent-stop': 'no-accessible-name',
  'unlabeled-image-control': 'unlabeled-icon',
  'small-touch-target': 'small-touch-target',
  'talkback-unreachable-control': 'unreachable-control',
  'talkback-ambiguous-announcement': 'ambiguous-announcement',
};

const CATEGORY_LABELS = {
  'no-accessible-name': 'No accessible name',
  'unlabeled-icon': 'Unlabeled icon control',
  'small-touch-target': 'Undersized touch target',
  'unreachable-control': 'Unreachable via TalkBack navigation',
  'ambiguous-announcement': 'Ambiguous / duplicate announcement',
};

// Closest applicable WCAG 2.1 success criterion for each native-check
// category. This is a manual mapping, not a claim that axe-core (or any
// WCAG-conformance tool) evaluated the criterion — axe-core never inspects
// native Android views. It's here so a reader can cross-reference native
// findings against the same WCAG vocabulary the WebView/axe-core column
// uses, the same way accessibility.spec.js's old WCAG-mapped report did
// before that mapping was removed from wcag-report.json (see README).
const CATEGORY_WCAG = {
  'no-accessible-name': 'WCAG 2.1 SC 4.1.2 (Name, Role, Value)',
  'unlabeled-icon': 'WCAG 2.1 SC 1.1.1 (Non-text Content)',
  'small-touch-target': 'WCAG 2.1 SC 2.5.5 (Target Size)',
  'unreachable-control': 'WCAG 2.1 SC 4.1.2 (Name, Role, Value)',
  'ambiguous-announcement': 'WCAG 2.1 SC 2.4.6 (Headings and Labels)',
};

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// axe-core tags its violations with the WCAG success criteria they map to as
// compact codes like "wcag412" (-> 4.1.2) or "wcag1410" (-> 1.4.10) alongside
// non-SC tags like "wcag2a"/"wcag2aa" (conformance level, not a criterion —
// deliberately not matched here since the trailing letter isn't a digit).
function axeTagsToWcag(tags) {
  if (!Array.isArray(tags)) return null;
  const scs = tags
    .map((t) => /^wcag(\d)(\d)(\d{1,2})$/.exec(t))
    .filter(Boolean)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  return scs.length ? `WCAG 2.1 SC ${scs.join(', ')}` : null;
}

/**
 * Merges one check's raw issue array (each item already tagged with a
 * `.source` — "Structural Sweep" or "TalkBack" — by functional.spec.js) into
 * `byKey`, deduplicating findings that different checks raised for the same
 * element on the same screen. Both sources already share a flat shape
 * ({ screen, type, class, bounds, detail }), so no normalization is needed.
 */
function mergeIssues(issues, byKey) {
  for (const issue of issues) {
    const category = CATEGORY_BY_TYPE[issue.type] || issue.type;
    // Ambiguous-announcement findings have no bounds (they span multiple
    // elements), so fall back to the detail text to distinguish separate
    // ambiguous groups on the same screen.
    const key = `${issue.screen}|${category}|${issue.bounds || issue.detail}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        screen: issue.screen,
        category,
        wcag: CATEGORY_WCAG[category] || null,
        class: issue.class,
        bounds: issue.bounds,
        details: new Set(),
        sources: new Set(),
        rawCount: 0,
      });
    }
    const entry = byKey.get(key);
    entry.details.add(issue.detail);
    entry.sources.add(issue.source || 'unknown');
    entry.rawCount += 1;
  }
}

function screenTable(rows) {
  if (!rows.length) return '<p class="empty">No issues found on this screen.</p>';
  return `
    <table>
      <thead>
        <tr><th>Issue</th><th>Element</th><th>Detail</th><th>WCAG</th><th>Reported by</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
          <td>${esc(CATEGORY_LABELS[row.category] || row.category)}</td>
          <td>${esc(row.class || '')}${row.bounds ? `<br><span class="bounds">${esc(row.bounds)}</span>` : ''}</td>
          <td>${[...row.details].map(esc).join('<br>')}</td>
          <td>${row.wcag ? esc(row.wcag) : '<span class="empty">—</span>'}</td>
          <td>${[...row.sources].map((s) => `<span class="tool-badge">${esc(s)}</span>`).join(' ')}</td>
        </tr>`
          )
          .join('\n')}
      </tbody>
    </table>`;
}

/**
 * Builds a self-contained HTML report with one screenshot per audited
 * screen, each followed by a deduplicated table of the issues found on it —
 * "deduplicated" meaning findings from the two native checks (structural
 * sweep, TalkBack) for the same element collapse into one row tagged with
 * all the checks that reported it, rather than one row per check. The
 * header reports both the total *unique* issue count (after dedup) and the
 * total *raw* issue count (before dedup, i.e. summed across every check's
 * own findings) so it's clear how much overlap there was.
 *
 * WCAG/axe-core findings (from `webviewResults`) are kept separate rather
 * than run through the same dedup pass: axe-core only ever scans a WebView's
 * real DOM, which the native structural/TalkBack checks never see, so there
 * is no cross-tool overlap there to collapse — every axe violation is
 * already its own unique issue.
 */
function generateA11yScreenshotReport({ screenshots, structuralIssues, talkbackIssues, webviewResults, generatedAt }) {
  const byKey = new Map();
  mergeIssues(structuralIssues, byKey);
  mergeIssues(talkbackIssues, byKey);

  const rowsByScreen = new Map();
  for (const entry of byKey.values()) {
    if (!rowsByScreen.has(entry.screen)) rowsByScreen.set(entry.screen, []);
    rowsByScreen.get(entry.screen).push(entry);
  }

  let webviewUniqueCount = 0;
  for (const w of webviewResults) {
    const violations = (w.axeResult && w.axeResult.violations) || [];
    webviewUniqueCount += violations.length;
    if (!violations.length) continue;
    if (!rowsByScreen.has(w.screen)) rowsByScreen.set(w.screen, []);
    for (const v of violations) {
      rowsByScreen.get(w.screen).push({
        category: 'axe-core',
        wcag: axeTagsToWcag(v.tags),
        class: v.id,
        bounds: null,
        details: new Set([v.description || v.help || '']),
        sources: new Set([`axe-core (${w.context})`]),
        rawCount: 1,
      });
    }
  }

  const totalUniqueIssues = byKey.size + webviewUniqueCount;
  const totalRawIssues = structuralIssues.length + talkbackIssues.length + webviewUniqueCount;

  const screenNames = Object.keys(screenshots);
  // Screens with issues but no captured screenshot (e.g. the screenshot
  // call failed) still get listed, just without an <img>.
  for (const screen of rowsByScreen.keys()) {
    if (!screenNames.includes(screen)) screenNames.push(screen);
  }

  const screenSections = screenNames
    .map((screen) => {
      const rows = rowsByScreen.get(screen) || [];
      const img = screenshots[screen]
        ? `<img src="data:image/png;base64,${screenshots[screen]}" alt="${esc(screen)} screenshot">`
        : '<p class="empty">No screenshot captured for this screen.</p>';
      return `
      <section class="screen">
        <h2>${esc(screen)} <span class="count">${rows.length} unique issue${rows.length === 1 ? '' : 's'}</span></h2>
        <div class="screen-body">
          <div class="screenshot">${img}</div>
          <div class="issues">${screenTable(rows)}</div>
        </div>
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MDA Accessibility Report — Screenshots</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: #666; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .stat { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem 1.25rem; min-width: 180px; }
  .stat .n { font-size: 1.8rem; font-weight: 700; display: block; }
  .stat.unique .n { color: #b00020; }
  .stat.raw .n { color: #8a6d00; }
  section.screen { margin-bottom: 3rem; border-top: 3px solid #eee; padding-top: 1.5rem; }
  section.screen h2 { display: flex; align-items: baseline; gap: 0.75rem; }
  section.screen h2 .count { font-size: 0.85rem; font-weight: 400; color: #666; }
  .screen-body { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
  .screenshot img { max-width: 320px; border: 1px solid #ccc; border-radius: 4px; display: block; }
  .issues { flex: 1; min-width: 340px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  tr:nth-child(even) { background: #fafafa; }
  .empty { color: #2e7d32; font-weight: 600; }
  .bounds { color: #888; font-size: 0.8rem; }
  .tool-badge { display: inline-block; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.75rem; margin: 0 0.15rem 0.15rem 0; white-space: nowrap; }
</style>
</head>
<body>
  <h1>MDA Accessibility Report — Screenshots</h1>
  <p class="meta">Generated ${esc(generatedAt)} — one screenshot per screen visited by the functional test flow, followed by every issue found on it, deduplicated across tools (a control flagged by more than one check appears once, tagged with all the tools that flagged it). The WCAG column shows the closest WCAG 2.1 success criterion for each row — for WebView/axe-core rows this comes straight from axe-core's own tags; for native rows it's a manual cross-reference (axe-core cannot inspect native views, so no tool claims to have evaluated these against WCAG directly).</p>

  <div class="summary">
    <div class="stat unique"><span class="n">${totalUniqueIssues}</span>Total unique issues</div>
    <div class="stat raw"><span class="n">${totalRawIssues}</span>Total issues found (before dedup)</div>
    <div class="stat"><span class="n">${screenNames.length}</span>Screens audited</div>
  </div>

  ${screenSections}
</body>
</html>`;
}

module.exports = { generateA11yScreenshotReport };
