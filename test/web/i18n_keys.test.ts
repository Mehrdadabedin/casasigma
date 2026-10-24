// Every UI string exists in all four languages (en, es, nl, da).
import { describe, expect, it } from 'vitest';
import { messages } from '../../src/i18n/messages';

describe('messages', () => {
  const english = Object.keys(messages.en).sort();
  it.each(['es', 'nl', 'da'] as const)('%s has exactly the English keys', (code) => {
    const keys = Object.keys(messages[code]).sort();
    expect(english.filter((key) => !keys.includes(key))).toEqual([]);
    expect(keys.filter((key) => !english.includes(key))).toEqual([]);
  });
});
