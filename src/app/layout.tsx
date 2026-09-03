import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegistrarServiceWorker } from './sw-registro';

export const metadata: Metadata = {
  title: 'Meridiano',
  description:
    'Todas as suas caixas de e-mail e todos os seus calendários sob uma única linha de referência.',
  // Instalado na tela inicial do iPhone, é isto que aparece embaixo do ícone.
  appleWebApp: { capable: true, title: 'Meridiano', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // `viewport-fit=cover` é o que impede a barra de navegação do iPhone de
  // comer a última linha da lista quando instalado na tela inicial.
  viewportFit: 'cover',
  themeColor: '#0f7d78',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
