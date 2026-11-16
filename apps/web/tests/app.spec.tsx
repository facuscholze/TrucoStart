import { DEFAULT_APP_NAME } from '@truco/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';

describe('@truco/web App shell (M0)', () => {
  it('renders parameterized product name without unimplemented interactive controls', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain(DEFAULT_APP_NAME);
    expect(html).toContain('STATE-05');
    expect(html).not.toContain('<button');
  });
});
