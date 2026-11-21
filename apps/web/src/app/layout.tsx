import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/lib/session';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'BECBarrier — Supplier Payment Integrity',
  description:
    'Review business-email indicators and enforce independently verified supplier-payment account changes with callback verification and dual approval.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
