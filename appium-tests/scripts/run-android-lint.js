const fs = require('fs');
const path = require('path');
const { runAndroidLintAccessibilityScan, LINT_HTML } = require('../utils/androidLint');

async function main() {
  const reportsDir = path.resolve(__dirname, '..', 'reports', 'a11y');
  const jsonDir = path.resolve(reportsDir, 'json');
  const htmlDir = path.resolve(reportsDir, 'html');
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(htmlDir, { recursive: true });

  console.log('Running Android Lint (accessibility category) via gradlew lintDebug...');
  const result = await runAndroidLintAccessibilityScan();

  const jsonPath = path.resolve(jsonDir, 'android-lint-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  if (result.ran && result.fullReportHtml) {
    fs.copyFileSync(result.fullReportHtml, path.resolve(htmlDir, 'android-lint-report.html'));
  }

  if (!result.ran) {
    console.log(`Android Lint did not produce a report: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n=== Android Lint: ${result.accessibilityIssueCount} accessibility issue(s) out of ${result.totalIssues} total ===`
  );
  for (const issue of result.accessibilityIssues) {
    const loc = issue.locations[0];
    console.log(`[${issue.severity}] ${issue.id}: ${issue.message}${loc ? ` (${loc.file}:${loc.line})` : ''}`);
  }
  console.log(`\nFull report written to ${jsonPath}`);
  if (result.fullReportHtml) {
    console.log(`Full Android Lint HTML report copied to ${path.resolve(htmlDir, 'android-lint-report.html')}`);
  }
}

main().catch((e) => {
  console.error('Android Lint scan failed:', e);
  process.exitCode = 1;
});
