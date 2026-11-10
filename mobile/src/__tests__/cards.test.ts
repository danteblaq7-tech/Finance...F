import { cardQrValue, extractCode } from '@/lib/cards';

describe('extractCode (same rule as the backend and the web app)', () => {
  it('reads the code from the QR link, a pasted link, or the bare code', () => {
    expect(extractCode('https://finesse.ac.ke/verify/ab12cd34ef56')).toBe('AB12CD34EF56');
    expect(extractCode('http://192.168.1.5:5173/verify/AB12CD34EF56/')).toBe('AB12CD34EF56');
    expect(extractCode('https://x.ke/verify/AB12CD34EF56?from=qr#top')).toBe('AB12CD34EF56');
    expect(extractCode('  ab12cd34ef56 ')).toBe('AB12CD34EF56');
  });
  it('rejects anything that cannot be a card code', () => {
    for (const bad of ['', '   ', 'short', 'has spaces in it', 'https://x.ke/other/AB12CD34EF56', 'AB12-CD34-EF56', 'A'.repeat(40)]) {
      expect(extractCode(bad)).toBeNull();
    }
  });
});

describe('cardQrValue', () => {
  it('is a link to the public check page when the web address is known, otherwise just the code', () => {
    expect(cardQrValue('AB12CD34EF56', 'https://finesse.ac.ke')).toBe('https://finesse.ac.ke/verify/AB12CD34EF56');
    expect(cardQrValue('AB12CD34EF56', 'https://finesse.ac.ke///')).toBe('https://finesse.ac.ke/verify/AB12CD34EF56');
    expect(cardQrValue('AB12CD34EF56', '')).toBe('AB12CD34EF56');
    expect(cardQrValue('AB12CD34EF56', undefined)).toBe('AB12CD34EF56');
  });
  it('what the QR holds is always something the scanner can read back', () => {
    for (const web of ['https://finesse.ac.ke', 'http://10.0.2.2:5173', undefined]) {
      expect(extractCode(cardQrValue('AB12CD34EF56', web))).toBe('AB12CD34EF56');
    }
  });
});
