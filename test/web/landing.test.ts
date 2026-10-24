import { describe, expect, it } from 'vitest';
import { landing, safeNext } from '../../src/lib/landing';

const user = (role: 'buyer' | 'seller' | 'admin', mustSetPassword = false) => ({ role, mustSetPassword });

describe('landing', () => {
  it('sends a buyer to Home by default', () => {
    expect(landing(user('buyer'), safeNext(null))).toBe('/');
  });
  it('sends a buyer to the page named in next', () => {
    expect(landing(user('buyer'), safeNext('/homes/x'))).toBe('/homes/x');
  });
  it('sends a seller to /sell and an admin to /admin', () => {
    expect(landing(user('seller'), safeNext(null))).toBe('/sell');
    expect(landing(user('admin'), safeNext(null))).toBe('/admin');
  });
  it('sends an admin on the starter password to the credential step', () => {
    expect(landing(user('admin', true), '/homes/x')).toBe('/admin/credentials');
  });
  it('refuses open redirects', () => {
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/login')).toBe('/');
  });
});
