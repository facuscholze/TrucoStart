import { cleanup, render, screen } from '@testing-library/react';
import { DEFAULT_APP_NAME } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';

afterEach(() => cleanup());

describe('@truco/web App shell & launcher (M5a)', () => {
  it('renders parameterized product name and functional table entry controls in Rioplatense Spanish', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: DEFAULT_APP_NAME })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Armar mesa privada 1v1/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Armar mesa privada 2v2/i })).toBeTruthy();
    expect(screen.getByLabelText(/Código de mesa privada de 6 caracteres/i)).toBeTruthy();
  });
});
