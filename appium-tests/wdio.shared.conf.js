const path = require('path');
const { ReportAggregator } = require('wdio-html-nice-reporter');

/**
 * Builds a wdio config scoped to one report suite (its own json/ and html/
 * output folders), so functional and accessibility runs don't overwrite
 * each other's reports.
 */
function createConfig({ suiteName, reportTitle, specs }) {
  const suiteReportsDir = path.resolve(__dirname, 'reports', suiteName);
  const jsonReportsDir = path.resolve(suiteReportsDir, 'json');
  const htmlReportsDir = path.resolve(suiteReportsDir, 'html');

  // wdio-html-nice-reporter joins outputDir onto process.cwd() itself, so it
  // must be given a path relative to the wdio process's cwd (this directory),
  // not an absolute path — passing an absolute path doubles up the drive
  // prefix and throws "Path contains invalid characters".
  const htmlReportsDirRelative = path.relative(__dirname, htmlReportsDir);

  let reportAggregator;

  return {
    runner: 'local',
    specs,
    maxInstances: 1,
    capabilities: [
      {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'Android Emulator',
        'appium:app': path.resolve(__dirname, '..', 'release', 'mda.apk'),
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 240,
      },
    ],
    logLevel: 'info',
    bail: 0,
    waitforTimeout: 20000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
    framework: 'mocha',
    reporters: [
      'spec',
      [
        'json',
        {
          outputDir: jsonReportsDir,
          outputFileFormat: (opts) => `results-${opts.cid}.json`,
        },
      ],
      [
        'html-nice',
        {
          outputDir: htmlReportsDirRelative,
          filename: 'report.html',
          reportTitle,
          useOnAfterCommandForScreenshot: false,
          showInBrowser: false,
          collapseTests: false,
        },
      ],
    ],
    mochaOpts: {
      ui: 'bdd',
      timeout: 180000,
    },
    reportsDir: suiteReportsDir,

    onPrepare: function () {
      reportAggregator = new ReportAggregator({
        outputDir: htmlReportsDirRelative,
        filename: 'report.html',
        reportTitle,
        collapseTests: false,
      });
      reportAggregator.clean();
    },

    onComplete: async function () {
      await reportAggregator.createReport();
    },
  };
}

module.exports = { createConfig };
