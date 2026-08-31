import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meridiano',
  description:
    'Todas as suas caixas de e-mail e todos os seus calendários sob uma única linha de referência.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
