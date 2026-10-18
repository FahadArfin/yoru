// Exercise the navigation available to the current viewport, including the phone sheet.
export async function navigateCollection(page, name, adult = false) {
  if (page.viewportSize().width <= 760) {
    await page
      .getByRole('navigation', { name: 'Phone navigation' })
      .getByRole('button', { name: 'Browse', exact: true })
      .click();
    const menu = page.getByRole('dialog', { name: 'Browse collections' });
    await menu
      .getByRole('link', {
        name: name === 'NSFW · Ara Ara, 18+' ? 'Ara Ara · 18+' : name,
        exact: true,
      })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: adult ? 'Explore Ara Ara' : 'Explore Yoru' })
      .getByRole('link', { name, exact: true })
      .click();
  }
}

export async function navigatePrimary(page, name) {
  await page
    .getByRole('navigation', {
      name: page.viewportSize().width <= 760 ? 'Phone navigation' : 'Explore Yoru',
    })
    .getByRole('link', { name, exact: true })
    .click();
}
