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

module.exports = { getDeviceDensity };
