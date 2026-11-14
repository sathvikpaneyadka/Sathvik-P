import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleLanguage, getLocaleStrings } from './i18n.ts';

test('getLocaleStrings returns translated labels and falls back to English', () => {
  assert.equal(getLocaleStrings('hi').navClinical, 'क्लिनिक और कतार');
  assert.equal(getLocaleStrings('es').prescriptionBtn, '1 · Ver Receta');
  assert.equal(getLocaleStrings('ta').navMap, 'நேரடி வரைபடம்');
  assert.equal(getLocaleStrings('unknown').navOverview, 'Overview');
});

test('cycleLanguage rotates through supported smart and keypad languages', () => {
  assert.equal(cycleLanguage('en'), 'hi');
  assert.equal(cycleLanguage('hi'), 'es');
  assert.equal(cycleLanguage('es'), 'ta');
  assert.equal(cycleLanguage('ta'), 'en');
});
