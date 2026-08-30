import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Torre de Comando',
  description: 'Gestao unificada de e-mails e calendarios de todas as contas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
