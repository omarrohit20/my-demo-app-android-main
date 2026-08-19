const { createConfig } = require('./wdio.shared.conf');

exports.config = createConfig({
  suiteName: 'a11y',
  reportTitle: 'MDA Accessibility Test Report',
  specs: [
    './specs/accessibility.spec.js',
    './specs/wcag-scan.spec.js',
    './specs/screenreader-tools.spec.js',
  ],
});
