function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function issueTable(headers, rows) {
  if (!rows.length) return '<p class="empty">No issues found.</p>';
  return `
    <table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * Builds a self-contained HTML report purely from accessibility findings
 * (structural sweep, real WCAG/axe-core WebView checks, TalkBack
 * evaluation, tool-availability). Deliberately independent of wdio's mocha
 * reporters — this report describes accessibility issues, not functional
 * test pass/fail, so it doesn't reuse wdio-html-nice-reporter's
 * test-suite-shaped output. See wdio.shared.conf.js's `includeMochaReports`.
 *
 * WCAG/axe-core coverage here is exactly what axe-core itself found in a
 * WebView's DOM — nothing from the native structural sweep is reshaped into
 * a synthetic "WCAG" finding, since axe-core never actually inspected native
 * views to produce it.
 */
function generateA11yHtmlReport({ structuralIssues, webviewResults, screenReader, otherToolsRequested, generatedAt }) {
  const structuralRows = structuralIssues.map((i) => [i.screen, i.type, i.class, i.bounds, i.detail]);
  const talkbackRows = screenReader.issues.map((i) => [i.screen, i.type, i.class, i.bounds, i.detail]);
  const wcagAxeRows = webviewResults.flatMap((w) =>
    ((w.axeResult && w.axeResult.violations) || []).map((v) => [
      w.screen,
      w.context,
      v.id,
      v.impact || '',
      v.description || v.help || '',
    ])
  );
  const toolRows = otherToolsRequested.map((t) => [t.tool, t.available ? 'Available' : 'Not available', t.reason]);

  const wcagAxeViolationCount = wcagAxeRows.length;
  const totalIssues = structuralIssues.length + wcagAxeViolationCount + screenReader.issues.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MDA Accessibility Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: #666; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .stat { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem 1.25rem; min-width: 160px; }
  .stat .n { font-size: 1.8rem; font-weight: 700; display: block; }
  .stat.total .n { color: #b00020; }
  section { margin-bottom: 2.5rem; }
  h2 { border-bottom: 2px solid #eee; padding-bottom: 0.4rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  tr:nth-child(even) { background: #fafafa; }
  .empty { color: #2e7d32; font-weight: 600; }
</style>
</head>
<body>
  <h1>MDA Accessibility Report</h1>
  <p class="meta">Generated ${esc(generatedAt)} — findings are collected from the functional test flow (see appium-tests/README.md, "How the accessibility scan piggybacks on it").</p>

  <div class="summary">
    <div class="stat total"><span class="n">${totalIssues}</span>Total issues</div>
    <div class="stat"><span class="n">${structuralIssues.length}</span>Structural sweep (native)</div>
    <div class="stat"><span class="n">${wcagAxeViolationCount}</span>WCAG/axe-core (WebView only)</div>
    <div class="stat"><span class="n">${screenReader.issues.length}</span>TalkBack</div>
    <div class="stat"><span class="n">${screenReader.enabled ? 'Yes' : 'No'}</span>TalkBack ran</div>
  </div>

  <section>
    <h2>Structural sweep (missing labels, unlabeled icons, undersized touch targets)</h2>
    <p class="meta">Native accessibility-node-tree checks. Not a WCAG/axe-core scan — axe-core cannot inspect native Android views at all.</p>
    ${issueTable(['Screen', 'Type', 'Class', 'Bounds', 'Detail'], structuralRows)}
  </section>

  <section>
    <h2>WCAG / axe-core (WebView contexts only)</h2>
    <p class="meta">Real axe-core scan results. Only ever populated for screens with an actual WebView/DOM context — this app is fully native except the WebView screen, so most runs report zero contexts scanned.</p>
    ${issueTable(['Screen', 'Context', 'Rule', 'Impact', 'Description'], wcagAxeRows)}
    <p class="meta">WebView contexts scanned: ${webviewResults.length}</p>
  </section>

  <section>
    <h2>TalkBack evaluation</h2>
    <p>Touch-exploration probe: ${esc(JSON.stringify(screenReader.touchExplorationProbe))}</p>
    ${issueTable(['Screen', 'Type', 'Class', 'Bounds', 'Detail'], talkbackRows)}
  </section>

  <section>
    <h2>Other requested tools</h2>
    ${issueTable(['Tool', 'Status', 'Reason'], toolRows)}
  </section>
</body>
</html>`;
}

module.exports = { generateA11yHtmlReport };
