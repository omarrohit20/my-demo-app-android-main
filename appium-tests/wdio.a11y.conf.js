const { createConfig } = require('./wdio.shared.conf');

// There is no separate accessibility spec: the a11y suite runs the exact
// same functional.spec.js as wdio.functional.conf.js, just with A11Y_SCAN=1
// set before wdio spawns its worker process(es) (which inherit this
// process's env). functional.spec.js reads that flag to run a real
// accessibility audit after every step of the functional flow, instead of a
// separate spec doing its own synthetic navigation. See functional.spec.js
// for the audit logic and reports/a11y/ for where it writes its output.
process.env.A11Y_SCAN = 'true';

exports.config = createConfig({
  suiteName: 'a11y',
  reportTitle: 'MDA Accessibility Test Report',
  specs: ['./specs/functional.spec.js'],
  // The functional flow's own mocha pass/fail isn't accessibility data —
  // don't let wdio's json/html-nice reporters write it into reports/a11y/.
  // functional.spec.js's after() hook writes the real accessibility-only
  // JSON + HTML reports directly (see utils/generateA11yHtmlReport.js).
  includeMochaReports: false,
});
