import { DEFAULT_APP_NAME } from '@truco/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminApp } from '../src/AdminApp.js';

describe('@truco/admin AdminApp shell (M0)', () => {
  it('renders isolated admin foundation view without unimplemented controls', () => {
    const html = renderToStaticMarkup(<AdminApp />);
    expect(html).toContain(DEFAULT_APP_NAME);
    expect(html).toContain('STATE-07');
    expect(html).not.toContain('<button');
  });
});
