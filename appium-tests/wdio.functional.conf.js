const { createConfig } = require('./wdio.shared.conf');

exports.config = createConfig({
  suiteName: 'functional',
  reportTitle: 'MDA Functional Test Report',
  specs: ['./specs/functional.spec.js'],
});
