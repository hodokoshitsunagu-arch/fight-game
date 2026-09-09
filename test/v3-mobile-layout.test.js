import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesUrl = new URL('../src/ui/styles.css', import.meta.url);
const hudUrl = new URL('../src/ui/V3AdventureHUD.js', import.meta.url);

test('390px adventure layout keeps four transparent ownership regions in a 2x2 viewport overlay', async () => {
  const [styles, hud] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(hudUrl, 'utf8'),
  ]);

  assert.match(hud, /v3-adventure-hud__touch-regions/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.v3-adventure-hud__touch-regions\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.v3-adventure-hud\s*\{[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(styles, /\.v3-adventure-hud__touch-region\s*\{[\s\S]*?background:\s*transparent;/);
  assert.doesNotMatch(styles, /\.v3-adventure-hud__touch-regions\s*\{[^}]*overflow:\s*(auto|scroll)/);
});
