const { expect } = require('chai');

// Functional smoke test for the Sauce Labs "My Demo App" (mda.apk).
// Covers the core shopping flow: browse -> product detail -> add to cart
// -> view cart -> open menu drawer. Pure UI/behavior verification, no
// accessibility assertions here (see accessibility.spec.js / wcag-scan.spec.js
// for that).

describe('MDA functional smoke test', () => {
  it('shows the product catalog on launch', async () => {
    const catalogTitle = await driver.$('id=com.saucelabs.mydemoapp.android:id/productTV');
    await catalogTitle.waitForDisplayed({ timeout: 15000 });
    expect(await catalogTitle.getText()).to.equal('Products');

    const productList = await driver.$('id=com.saucelabs.mydemoapp.android:id/productRV');
    expect(await productList.isDisplayed()).to.be.true;
  });

  it('updates the cart badge after adding a product to the cart', async () => {
    const firstProduct = await driver.$(
      '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
    );
    await firstProduct.waitForDisplayed({ timeout: 15000 });
    await firstProduct.click();

    const addToCartBtn = await driver.$(
      '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/addToCartBtn" or @resource-id="com.saucelabs.mydemoapp.android:id/cartBt"]'
    );
    await addToCartBtn.waitForDisplayed({ timeout: 15000 });
    await addToCartBtn.click();

    const cartBadge = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartTV');
    await cartBadge.waitForDisplayed({ timeout: 10000 });
    expect(await cartBadge.getText()).to.match(/^[1-9]\d*$/);
  });

  it('shows the added product in the cart screen', async () => {
    const cartIcon = await driver.$('id=com.saucelabs.mydemoapp.android:id/cartRL');
    await cartIcon.waitForDisplayed({ timeout: 10000 });
    await cartIcon.click();

    const cartScreenTitle = await driver.$(
      '//android.widget.TextView[@text="My Cart"]'
    );
    await cartScreenTitle.waitForDisplayed({ timeout: 10000 });

    const cartItem = await driver.$(
      '//android.widget.TextView[@resource-id="com.saucelabs.mydemoapp.android:id/titleTV"]'
    );
    expect(await cartItem.isDisplayed()).to.be.true;

    await driver.back();
  });

  it('opens the navigation menu drawer', async () => {
    const menuIcon = await driver.$('id=com.saucelabs.mydemoapp.android:id/menuIV');
    await menuIcon.waitForDisplayed({ timeout: 10000 });
    await menuIcon.click();

    const drawer = await driver.$(
      '//android.view.ViewGroup[contains(@resource-id, "menuLayout") or contains(@resource-id, "container")]'
    );
    await drawer.waitForDisplayed({ timeout: 10000 });

    // close the drawer so subsequent tests start from a known state
    await driver.back();
  });
});
