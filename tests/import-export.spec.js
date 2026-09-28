// Pasted lists, duplicates, and exports.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { mockNet, openApp, click, epilogue, summary } = require('./helpers');

test('a pasted list is previewed, flags books already owned, and imports to the chosen shelf', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const count = t => +t.match(/of ([\d,]+)/)[1].replace(',', '');
  const before = count(await summary(page));
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="import"]');
  await page.fill('#imp-text', 'Title,Author\nA Brand New Book,Jane Doe\nDriftwood Valley,Theodora Stanwell-Fletcher');
  await click(page, '#btn-parse');
  await expect(page.locator('#imp-rows')).toContainText('A Brand New Book');
  await expect(page.locator('#imp-rows tr.dup')).toHaveCount(1);
  await page.fill('#imp-room', 'Den'); await page.fill('#imp-case', 'Low bookcase'); await page.fill('#imp-shelf', '2');
  await page.selectOption('#imp-dups', 'skip');
  await click(page, '#btn-do-import');
  await expect(page.locator('#toast')).toContainText('Imported 1');
  await click(page, '.panel.active .back-link');
  expect(count(await summary(page))).toBe(before + 1);
});

test('CSV export has one row per book (sold ones left out) and no value column', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await epilogue(page, 'data');
  const [dl] = await Promise.all([page.waitForEvent('download'), click(page, '#btn-export-csv')]);
  const text = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  const header = text.split('\r\n')[0].split(',');
  expect(header.slice(0, 2)).toEqual(['title', 'author']);
  expect(header).not.toContain('value');
  const shown = +(await page.evaluate(() => document.getElementById('hdr-count').textContent)).replace(/\D/g, '');
  expect(text.split('\r\n').length - 1).toBe(shown);
});

test('JSON backup is the readable format', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await epilogue(page, 'data');
  const [dl] = await Promise.all([page.waitForEvent('download'), click(page, '#btn-export-json')]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  expect(text.startsWith('{\n  "format": "tamarack-library"')).toBeTruthy();
});

test('the unidentified list groups mystery books by shelf', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="unid"]');
  await expect(page.locator('#un-summary')).toContainText(/\d+/);
  expect(await page.locator('#un-list .un-row').count()).toBeGreaterThan(5);
});
