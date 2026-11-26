import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LEGAL_DOCUMENT_SLUGS, LEGAL_DRAFT_BANNER, LEGAL_MIN_AGE_DEFAULT } from '@truco/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegalScreen } from '../src/features/legal/LegalScreen.js';
import { legalDocuments } from '../src/features/legal/legal-content.js';

/**
 * M8d — páginas legales, aviso de borrador y enlaces obligatorios.
 *
 * Lo que se protege acá no es estética: es que ningún documento pueda publicarse
 * sin la marca de borrador y que todos los documentos estén alcanzables desde el
 * registro y el pie del sitio.
 */

const registerAccountRequest = vi.fn();

vi.mock('../src/lib/api-client.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/lib/api-client.js');
  return {
    ...actual,
    registerAccountRequest: (...args: unknown[]) => registerAccountRequest(...args),
  };
});

const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('M8d — índice de documentos legales', () => {
  it('muestra los cuatro documentos y la edad mínima recibida', () => {
    render(<LegalScreen activeSlug={null} minAge={21} onNavigate={navigate} />);

    expect(
      screen.getByText(/edad mínima para crear cuenta está configurada en 21 años/i),
    ).toBeTruthy();
    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      expect(screen.getByText(legalDocuments[slug].title)).toBeTruthy();
    }
  });

  it('siempre muestra el aviso de BORRADOR, pendiente de revisión legal', () => {
    render(<LegalScreen activeSlug={null} minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />);
    expect(screen.getByText(LEGAL_DRAFT_BANNER)).toBeTruthy();
  });

  it('navega al documento elegido', () => {
    render(<LegalScreen activeSlug={null} minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />);
    fireEvent.click(screen.getByText(legalDocuments.terminos.title));
    expect(navigate).toHaveBeenCalledWith('/legal/terminos');
  });
});

describe('M8d — documento legal individual', () => {
  it('renderiza todas las secciones y el aviso de borrador en cada documento', () => {
    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      const doc = legalDocuments[slug];
      const { unmount } = render(
        <LegalScreen activeSlug={slug} minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />,
      );

      expect(screen.getByText(LEGAL_DRAFT_BANNER)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(doc.title);
      for (const section of doc.sections) {
        expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
      }
      unmount();
    }
  });

  it('los términos declaran explícitamente que no hay dinero real ni transferencias', () => {
    render(
      <LegalScreen activeSlug="terminos" minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/no hay depósitos ni pagos dentro del juego/i);
    expect(text).toMatch(/no hay retiros, cobros ni conversión de puntos a dinero/i);
    expect(text).toMatch(/monedas virtuales simbólicas \(virtual_coin\)/i);
    expect(text).toMatch(/no tienen valor económico, no se compran con dinero ni se transfieren/i);
    expect(text).toMatch(/no existe transferencia de puntos, monedas ni objetos entre jugadores/i);
  });

  it('la política de privacidad enumera los datos que realmente se guardan', () => {
    render(
      <LegalScreen activeSlug="privacidad" minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />,
    );
    const text = document.body.textContent ?? '';
    // Datos que existen en el esquema real (users / profiles / sessions / matches).
    expect(text).toMatch(/correo electrónico/i);
    expect(text).toMatch(/hash criptográfico/i);
    expect(text).toMatch(/nombre del dispositivo, user agent e IP/i);
    expect(text).toMatch(/constancia de aceptación legal/i);
    // Y declara lo que NO se guarda.
    expect(text).toMatch(/no se guarda la edad declarada/i);
    expect(text).toMatch(/no se guardan datos de tarjetas/i);
    expect(text).toMatch(/monedas virtuales simbólicas \(virtual_coin\)/i);
    expect(text).toMatch(/no tienen valor económico ni se transfieren entre cuentas/i);
  });

  it('la política de cookies no inventa cookies de terceros', () => {
    render(
      <LegalScreen activeSlug="cookies" minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/no se usan cookies publicitarias/i);
  });

  it('enlaza al resto de los documentos', () => {
    render(
      <LegalScreen activeSlug="terminos" minAge={LEGAL_MIN_AGE_DEFAULT} onNavigate={navigate} />,
    );
    const others = screen.getByRole('navigation', { name: /otros documentos/i });
    fireEvent.click(within(others).getByText(legalDocuments.privacidad.title));
    expect(navigate).toHaveBeenCalledWith('/legal/privacidad');
  });
});

describe('M8d — aceptación obligatoria en el registro', () => {
  it('no envía el alta si no se marcó la casilla de aceptación', async () => {
    const { AuthScreen } = await import('../src/features/auth/AuthScreen.js');

    render(
      <AuthScreen
        currentUser={null}
        initialTab="register"
        legalMinAge={18}
        onSessionChanged={vi.fn()}
        onNavigate={navigate}
      />,
    );

    const submit = screen.getByRole('button', { name: /crear cuenta y entrar/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/marcá la casilla de aceptación/i);
    });
    expect(registerAccountRequest).not.toHaveBeenCalled();
  });

  it('muestra la edad mínima configurada y bloquea si la edad declarada no alcanza', async () => {
    const { AuthScreen } = await import('../src/features/auth/AuthScreen.js');

    render(
      <AuthScreen
        currentUser={null}
        initialTab="register"
        legalMinAge={21}
        onSessionChanged={vi.fn()}
        onNavigate={navigate}
      />,
    );

    expect(screen.getByText(/al menos 21 años/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/apodo en la mesa/i), {
      target: { value: 'TesterUno' },
    });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
      target: { value: 'tester@truco.ar' },
    });
    fireEvent.change(screen.getByLabelText(/contraseña/i), {
      target: { value: 'ClaveFuerte123' },
    });
    fireEvent.change(screen.getByLabelText(/declaro tener/i), { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText(/acepto los términos/i));

    fireEvent.click(screen.getByRole('button', { name: /crear cuenta y entrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/no alcanza el mínimo de 21 años/i);
    });
    expect(registerAccountRequest).not.toHaveBeenCalled();
  });

  it('envía la aceptación con la versión de los documentos y la edad declarada', async () => {
    registerAccountRequest.mockResolvedValue({
      user: { id: 'u1', nickname: 'TesterUno', isGuest: false },
    });
    const onSessionChanged = vi.fn();
    const { AuthScreen } = await import('../src/features/auth/AuthScreen.js');

    render(
      <AuthScreen
        currentUser={null}
        initialTab="register"
        legalMinAge={18}
        onSessionChanged={onSessionChanged}
        onNavigate={navigate}
      />,
    );

    fireEvent.change(screen.getByLabelText(/apodo en la mesa/i), {
      target: { value: 'TesterUno' },
    });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
      target: { value: 'tester@truco.ar' },
    });
    fireEvent.change(screen.getByLabelText(/contraseña/i), {
      target: { value: 'ClaveFuerte123' },
    });
    fireEvent.change(screen.getByLabelText(/declaro tener/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/acepto los términos/i));

    fireEvent.click(screen.getByRole('button', { name: /crear cuenta y entrar/i }));

    await waitFor(() => {
      expect(registerAccountRequest).toHaveBeenCalledTimes(1);
    });

    const payload = registerAccountRequest.mock.calls[0]?.[0] as {
      nickname: string;
      legal: { accepted: boolean; age: number; versions: Record<string, string> };
    };
    expect(payload.nickname).toBe('TesterUno');
    expect(payload.legal.accepted).toBe(true);
    expect(payload.legal.age).toBe(30);
    expect(payload.legal.versions['terminos']).toBeTruthy();
    expect(payload.legal.versions['privacidad']).toBeTruthy();
  });
});
