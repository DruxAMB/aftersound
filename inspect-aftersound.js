const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://aftersound-fawn.vercel.app', { waitUntil: 'networkidle' });

  // Check the CTA button
  const ctaInfo = await page.evaluate(() => {
    const btn = document.querySelector('[data-animate="cta"]');
    if (!btn) return 'no CTA button found';
    const style = window.getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    return {
      text: btn.textContent.trim(),
      bg: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily.substring(0, 60),
      borderRadius: style.borderRadius,
      height: rect.height + 'px',
      width: rect.width + 'px',
      border: style.border,
      boxShadow: style.boxShadow.substring(0, 150),
      className: btn.className.substring(0, 80),
    };
  });
  console.log('CTA:', JSON.stringify(ctaInfo, null, 2));

  // Check the H1
  const h1Info = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (!h1) return 'no h1';
    const style = window.getComputedStyle(h1);
    return {
      text: h1.textContent.substring(0, 60),
      fontSize: style.fontSize,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily.substring(0, 60),
      color: style.color,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
    };
  });
  console.log('H1:', JSON.stringify(h1Info, null, 2));

  // Check body background
  const bgInfo = await page.evaluate(() => {
    const style = window.getComputedStyle(document.body);
    return {
      bg: style.backgroundColor,
      color: style.color,
      fontFamily: style.fontFamily.substring(0, 60),
    };
  });
  console.log('BODY:', JSON.stringify(bgInfo, null, 2));

  // Check ghost wordmark
  const ghostInfo = await page.evaluate(() => {
    const ghost = document.querySelector('.ghost-wordmark');
    if (!ghost) return 'no ghost wordmark';
    const style = window.getComputedStyle(ghost);
    const rect = ghost.getBoundingClientRect();
    return {
      text: ghost.textContent,
      fontSize: style.fontSize,
      color: style.color,
      opacity: style.opacity,
      fontFamily: style.fontFamily.substring(0, 60),
      width: rect.width + 'px',
      height: rect.height + 'px',
    };
  });
  console.log('GHOST:', JSON.stringify(ghostInfo, null, 2));

  // Check EQ bars
  const eqInfo = await page.evaluate(() => {
    const bars = document.querySelectorAll('.animate-eq-bar');
    if (bars.length === 0) return 'no EQ bars found';
    const first = bars[0];
    const style = window.getComputedStyle(first);
    const parent = first.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    return {
      count: bars.length,
      barBg: style.backgroundColor,
      barWidth: first.getBoundingClientRect().width + 'px',
      parentOpacity: parentStyle.opacity,
      parentHeight: parentStyle.height,
    };
  });
  console.log('EQ BARS:', JSON.stringify(eqInfo, null, 2));

  // Check scene buttons
  const sceneInfo = await page.evaluate(() => {
    const btn = document.querySelector('[data-animate="scene-btn"]');
    if (!btn) return 'no scene button';
    const style = window.getComputedStyle(btn);
    return {
      text: btn.textContent.trim(),
      bg: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      borderRadius: style.borderRadius,
      border: style.border,
      height: style.height,
      boxShadow: style.boxShadow.substring(0, 100),
    };
  });
  console.log('SCENE BTN:', JSON.stringify(sceneInfo, null, 2));

  await browser.close();
})();
