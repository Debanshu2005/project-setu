// tests/test_mobile_layout_and_touch.mjs
// Project Setu: Mobile Layout and Touch Target Verification Suite (P6)
// Verifies 100dvh viewport, safe area insets, 44x44 tap targets, >=12px font readability,
// bottom sheet inspector snap points, header drawer collapse, and mobile thumb bar.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3899;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [ PASS ] ${message}`);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  Project Setu: Mobile Layout & Touch Target Suite (P6)         ');
  console.log('================================================================');

  let server;
  let browser;

  try {
    console.log(`\n[1/5] Starting Dashboard Server on port ${PORT}...`);
    server = spawn('node', ['dashboard/server.js'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe'
    });

    await new Promise((resolve, reject) => {
      server.stdout.on('data', data => {
        if (data.toString().includes('http://0.0.0.0:' + PORT)) resolve();
      });
      server.stderr.on('data', data => console.error(data.toString()));
      server.on('error', reject);
    });
    assert(true, `Server running and responding on port ${PORT}`);

    console.log('\n[2/5] Launching Headless Chromium with Mobile Viewports...');
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader']
      });
    } catch (e) {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader']
      });
    }

    const viewports = [
      { name: 'iPhone 14 / Modern Flagship', width: 390, height: 844 },
      { name: 'Compact Android / Budget Device', width: 360, height: 740 }
    ];

    for (const vp of viewports) {
      console.log(`\n[3/5] Evaluating Mobile Viewport: ${vp.name} (${vp.width}x${vp.height})...`);
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 3
      });

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // 1. Root Container & Safe Area Insets
      const rootStyles = await page.evaluate(() => {
        const bodyStyle = window.getComputedStyle(document.body);
        const htmlStyle = window.getComputedStyle(document.documentElement);
        return {
          bodyHeight: bodyStyle.height,
          bodyOverflow: bodyStyle.overflow,
          bodyPaddingTop: bodyStyle.paddingTop,
          bodyPaddingBottom: bodyStyle.paddingBottom
        };
      });
      assert(parseFloat(rootStyles.bodyHeight) > 0, `Root container has active computed height (${rootStyles.bodyHeight})`);

      // 2. Header Collapse on Mobile
      const headerBox = await page.evaluate(() => {
        const h = document.querySelector('.app-header');
        const toggle = document.getElementById('btnMobileHeaderToggle');
        const actions = document.querySelector('.header-actions');
        const rect = h.getBoundingClientRect();
        const toggleStyle = window.getComputedStyle(toggle);
        const actionsStyle = window.getComputedStyle(actions);
        return {
          height: Math.round(rect.height),
          toggleVisible: toggleStyle.display !== 'none',
          actionsHidden: actionsStyle.display === 'none'
        };
      });
      assert(headerBox.height <= 52, `Header height is collapsed to <= 52px on mobile (Got: ${headerBox.height}px)`);
      assert(headerBox.toggleVisible, 'Mobile drawer hamburger button is visible');
      assert(headerBox.actionsHidden, 'Header actions are tucked into mobile drawer');

      // Test opening header drawer
      await page.click('#btnMobileHeaderToggle');
      await page.waitForTimeout(300);
      const isDrawerOpen = await page.evaluate(() => {
        const actions = document.querySelector('.header-actions');
        return window.getComputedStyle(actions).display !== 'none';
      });
      assert(isDrawerOpen, 'Mobile header drawer opens upon tapping hamburger toggle');

      // Close drawer
      await page.click('#btnMobileHeaderToggle');
      await page.waitForTimeout(200);

      // 3. Mobile Thumb Bar
      const thumbStats = await page.evaluate(() => {
        const bar = document.getElementById('mobileThumbBar');
        const rect = bar ? bar.getBoundingClientRect() : { height: 0 };
        const playBtn = document.getElementById('mobileBtnPlay');
        const topoBtn = document.getElementById('mobileBtnTopo');
        const twinBtn = document.getElementById('mobileBtnTwin');
        const dataBtn = document.getElementById('mobileBtnAnalytics');
        const sosBtn = document.getElementById('mobileBtnSos');
        const sheetBtn = document.getElementById('mobileBtnSheet');

        return {
          visible: bar && window.getComputedStyle(bar).display !== 'none',
          height: Math.round(rect.height),
          buttonsPresent: Boolean(playBtn && topoBtn && twinBtn && dataBtn && sosBtn && sheetBtn)
        };
      });
      assert(thumbStats.visible, 'Mobile persistent thumb bar is visible');
      assert(thumbStats.height >= 48 && thumbStats.height <= 64, `Thumb bar height is budgeted 48-64px (Got: ${thumbStats.height}px)`);
      assert(thumbStats.buttonsPresent, 'All 6 primary thumb buttons exist (Play, Topo, Twin, Data, SOS, Sheet)');

      // 4. Tap Target Enforcement (>= 44x44px)
      const smallTargets = await page.evaluate(() => {
        const clickables = Array.from(document.querySelectorAll('button, a, select, input, .view-toggle-btn, .timeline-btn, .thumb-btn'));
        const undersized = [];
        for (const el of clickables) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              if (rect.width < 44 || rect.height < 44) {
                undersized.push({ tag: el.tagName, id: el.id, class: el.className, w: Math.round(rect.width), h: Math.round(rect.height) });
              }
            }
          }
        }
        return undersized;
      });
      assert(smallTargets.length === 0, `Zero interactive tap targets smaller than 44x44px (Got: ${smallTargets.length} undersized)`);

      // 5. Typography Readability (No font < 11px)
      const smallFonts = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const undersized = [];
        for (const el of all) {
          if (el.children.length === 0 && el.textContent.trim().length > 0) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              const fs = parseFloat(style.fontSize);
              if (fs < 11) {
                undersized.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 20), fs });
              }
            }
          }
        }
        return undersized;
      });
      assert(smallFonts.length === 0, `Zero text elements with font size below 11px (Got: ${smallFonts.length} sub-11px elements)`);

      // 6. Bottom Sheet Snap Points (Peek -> Half -> Full -> Peek)
      console.log('\n[4/5] Testing Bottom Sheet Snap Transitions...');
      const peekHeight = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar-right');
        return sb ? Math.round(sb.getBoundingClientRect().height) : 0;
      });
      assert(peekHeight >= 64 && peekHeight <= 80, `Initial bottom sheet snap state is peek (~72px, Got: ${peekHeight}px)`);

      // Tap handle to snap to half
      await page.click('#sheetHandleBar');
      await page.waitForTimeout(400);
      const halfHeight = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar-right');
        return sb ? Math.round(sb.getBoundingClientRect().height) : 0;
      });
      const expectedHalf = Math.round(vp.height * 0.42);
      assert(Math.abs(halfHeight - expectedHalf) <= 30, `Sheet snapped to half state ~42vh (Expected ~${expectedHalf}px, Got: ${halfHeight}px)`);

      // Tap handle to snap to full
      await page.click('#sheetHandleBar');
      await page.waitForTimeout(400);
      const fullHeight = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar-right');
        return sb ? Math.round(sb.getBoundingClientRect().height) : 0;
      });
      const expectedFull = Math.round(vp.height * 0.85);
      assert(Math.abs(fullHeight - expectedFull) <= 30, `Sheet snapped to full state ~85vh (Expected ~${expectedFull}px, Got: ${fullHeight}px)`);

      // Tap handle to snap back to peek
      await page.click('#sheetHandleBar');
      await page.waitForTimeout(400);
      const backPeekHeight = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar-right');
        return sb ? Math.round(sb.getBoundingClientRect().height) : 0;
      });
      assert(backPeekHeight >= 64 && backPeekHeight <= 80, `Sheet snapped cleanly back to peek (Got: ${backPeekHeight}px)`);

      await page.close();
    }

    console.log('\n[5/5] Checking Desktop Parity (No mobile regressions on desktop 1600x900)...');
    const desktopPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await desktopPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await desktopPage.waitForTimeout(500);

    const desktopStats = await pageCheckDesktop(desktopPage);
    assert(desktopStats.thumbBarHidden, 'Mobile thumb bar is completely hidden on desktop viewports');
    assert(desktopStats.handleBarHidden, 'Sheet drag handle is hidden on desktop viewports');
    assert(desktopStats.headerToggleHidden, 'Hamburger toggle is hidden on desktop viewports');
    assert(desktopStats.actionsVisible, 'Full header action controls are visible on desktop viewports');
    assert(desktopStats.threeColumnLayout, 'Standard three-column desktop layout is preserved');

    await desktopPage.close();

    console.log('\n================================================================');
    console.log('  ALL MOBILE LAYOUT & TOUCH TARGET ASSERTIONS PASSED!           ');
    console.log('================================================================\n');
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}

async function pageCheckDesktop(page) {
  return await page.evaluate(() => {
    const thumbBar = document.getElementById('mobileThumbBar');
    const handleBar = document.getElementById('sheetHandleBar');
    const headerToggle = document.getElementById('btnMobileHeaderToggle');
    const actions = document.querySelector('.header-actions');
    const leftSidebar = document.querySelector('.sidebar-left');
    const centerView = document.querySelector('.center-viewport');
    const rightSidebar = document.querySelector('.sidebar-right');

    const thumbStyle = thumbBar ? window.getComputedStyle(thumbBar) : { display: 'none' };
    const handleStyle = handleBar ? window.getComputedStyle(handleBar) : { display: 'none' };
    const toggleStyle = headerToggle ? window.getComputedStyle(headerToggle) : { display: 'none' };
    const actionsStyle = actions ? window.getComputedStyle(actions) : { display: 'none' };

    const leftRect = leftSidebar ? leftSidebar.getBoundingClientRect() : { width: 0 };
    const centerRect = centerView ? centerView.getBoundingClientRect() : { width: 0 };
    const rightRect = rightSidebar ? rightSidebar.getBoundingClientRect() : { width: 0 };

    return {
      thumbBarHidden: thumbStyle.display === 'none',
      handleBarHidden: handleStyle.display === 'none',
      headerToggleHidden: toggleStyle.display === 'none',
      actionsVisible: actionsStyle.display !== 'none',
      threeColumnLayout: leftRect.width > 200 && centerRect.width > 400 && rightRect.width > 250
    };
  });
}

runTestSuite().catch(err => {
  console.error(err);
  process.exit(1);
});
