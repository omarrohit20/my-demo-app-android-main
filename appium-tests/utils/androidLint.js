const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseStringPromise } = require('xml2js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const GRADLEW = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const LINT_XML = path.resolve(PROJECT_ROOT, 'app', 'build', 'reports', 'lint-results-debug.xml');
const LINT_HTML = path.resolve(PROJECT_ROOT, 'app', 'build', 'reports', 'lint-results-debug.html');

// Lint issue ids that fall under Android Lint's "Accessibility" category.
// (Lint's own <issue category="..."> attribute is usually "Accessibility"
// too, but we match on id as well since some AGP versions file a few of
// these under "Usability:Accessibility" or similar variants.)
const ACCESSIBILITY_ISSUE_IDS = new Set([
  'ContentDescription',
  'ClickableViewAccessibility',
  'LabelFor',
  'SelectableText',
  'ClickableLabel',
  'KeyboardInaccessibleWidget',
  'DuplicateSpeakableTextCheck',
  'RtlHardcoded',
]);

function isAccessibilityIssue(issue) {
  const category = (issue.$.category || '').toLowerCase();
  return category.includes('accessibility') || ACCESSIBILITY_ISSUE_IDS.has(issue.$.id);
}

async function parseLintXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const parsed = await parseStringPromise(xml);
  const issues = parsed.issues && parsed.issues.issue ? parsed.issues.issue : [];
  return issues.map((issue) => ({
    id: issue.$.id,
    severity: issue.$.severity,
    category: issue.$.category,
    message: issue.$.message,
    explanation: issue.$.explanation,
    locations: (issue.location || []).map((loc) => ({
      file: loc.$.file,
      line: loc.$.line,
      column: loc.$.column,
    })),
  }));
}

/**
 * Runs `gradlew lintDebug` against the app module and returns its
 * accessibility-category findings. Unlike Axe DevTools Mobile / Accessibility
 * Scanner / Android ATF (see utils/toolAvailability.js), Android Lint is a
 * static source analyzer — it needs the app's Gradle project (which this repo
 * has), not a running device/emulator or a paid SDK linked into the APK, so
 * it can actually be executed here.
 */
function runAndroidLintAccessibilityScan() {
  try {
    execFileSync(GRADLEW, ['lintDebug'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
  } catch (e) {
    // Lint exits non-zero when it finds issues at/above the configured
    // severity threshold; the XML report is still written in that case, so
    // only bail out if the report itself never got produced.
    if (!fs.existsSync(LINT_XML)) {
      return {
        tool: 'Android Lint',
        available: true,
        ran: false,
        reason: `gradlew lintDebug failed before producing a report: ${e.message}`,
      };
    }
  }

  if (!fs.existsSync(LINT_XML)) {
    return {
      tool: 'Android Lint',
      available: true,
      ran: false,
      reason: `Lint ran but no report was found at ${LINT_XML}`,
    };
  }

  return parseLintXml(LINT_XML).then((allIssues) => {
    const accessibilityIssues = allIssues.filter(isAccessibilityIssue);
    return {
      tool: 'Android Lint',
      available: true,
      ran: true,
      totalIssues: allIssues.length,
      accessibilityIssueCount: accessibilityIssues.length,
      accessibilityIssues,
      fullReportXml: LINT_XML,
      fullReportHtml: fs.existsSync(LINT_HTML) ? LINT_HTML : null,
    };
  });
}

module.exports = { runAndroidLintAccessibilityScan, LINT_XML, LINT_HTML };
