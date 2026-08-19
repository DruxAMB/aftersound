const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://www.monologue.to', { waitUntil: 'networkidle' });

  // Get hero section full info
  const heroSection = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const h1Style = h1 ? window.getComputedStyle(h1) : null;
    const h1Rect = h1 ? h1.getBoundingClientRect() : null;

    // Get the hero area — first section after nav
    const sections = document.querySelectorAll('section, header, [class*="hero"], [class*="Hero"]');
    const firstSection = sections[0] || document.querySelector('main > div');

    // Get all text in the hero area
    const heroText = [];
    const walk = (node, depth = 0) => {
      if (depth > 3) return;
      if (node.nodeType === 3) {
        const t = node.textContent.trim();
        if (t) heroText.push(t);
      }
      node.childNodes.forEach(child => walk(child, depth + 1));
    };
    if (h1) {
      let parent = h1.parentElement;
      while (parent && parent.tagName !== 'SECTION' && parent.tagName !== 'HEADER' && !parent.className.includes('hero')) {
        parent = parent.parentElement;
      }
      if (parent) walk(parent);
    }

    return {
      h1: h1 ? {
        text: h1.textContent,
        fontSize: h1Style.fontSize,
        fontStyle: h1Style.fontStyle,
        fontWeight: h1Style.fontWeight,
        fontFamily: h1Style.fontFamily.substring(0, 60),
        color: h1Style.color,
        letterSpacing: h1Style.letterSpacing,
        lineHeight: h1Style.lineHeight,
        textAlign: h1Style.textAlign,
        width: h1Rect.width + 'px',
        height: h1Rect.height + 'px',
      } : null,
      heroTexts: heroText.slice(0, 15),
    };
  });
  console.log('HERO SECTION:', JSON.stringify(heroSection, null, 2));

  // Get the primary CTA button full computed style
  const ctaInfo = await page.evaluate(() => {
    const btn = document.querySelector('.button--primary');
    if (!btn) return 'no primary button';
    const style = window.getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    return {
      text: btn.textContent.trim(),
      bg: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily.substring(0, 60),
      borderRadius: style.borderRadius,
      padding: style.padding,
      height: rect.height + 'px',
      width: rect.width + 'px',
      border: style.border,
      boxShadow: style.boxShadow,
      transition: style.transition,
    };
  });
  console.log('CTA BUTTON:', JSON.stringify(ctaInfo, null, 2));

  // Check for any animations / decorative elements
  const animInfo = await page.evaluate(() => {
    const animated = document.querySelectorAll('[class*="animate"], [class*="wave"], [class*="pulse"], [class*="glow"], canvas, svg');
    return Array.from(animated).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className.toString().substring(0, 80),
      width: el.getBoundingClientRect().width + 'px',
      height: el.getBoundingClientRect().height + 'px',
    }));
  });
  console.log('ANIMATED ELEMENTS:', JSON.stringify(animInfo, null, 2));

  await browser.close();
})();
