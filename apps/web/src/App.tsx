import { DEFAULT_APP_NAME } from '@truco/shared';
import { Badge } from '@truco/ui';

// TODO(STATE-05): Implementar en M5 el enrutamiento completo y pantallas MVP (onboarding, auth, lobby, mesa responsive, aprender, anotador).
export function App() {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;

  return (
    <main className="min-h-screen bg-cloth text-ivory flex items-center justify-center p-6">
      <section
        aria-labelledby="app-heading"
        className="max-w-lg w-full rounded-2xl bg-surface p-8 border border-gold/30 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <Badge variant="gold">Etapa 1 · MVP</Badge>
          <Badge variant="success">M0 Fundación activa</Badge>
        </div>
        <h1 id="app-heading" className="font-display text-3xl font-bold text-ivory">
          {appName}
        </h1>
        <p className="text-ivory/85 text-sm leading-relaxed">
          Infraestructura base de la PWA inicializada. Las pantallas de lobby, mesa en tiempo real,
          aprendizaje y anotador están programadas en el módulo M5 (STATE-05).
        </p>
      </section>
    </main>
  );
}
