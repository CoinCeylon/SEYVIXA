import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'SEYVIXA TrustOS',
  description: 'A trust layer for AI agents in SME procurement',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-slate-900">
                SEYVIXA <span className="text-indigo-600 font-semibold">TrustOS</span>
              </span>
            </div>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/workspace"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                Procurement Workspace
              </Link>
              <Link
                href="/trust"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                Trust &amp; Approval Centre
              </Link>
              <Link
                href="/settlement"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                Settlement &amp; Proof Centre
              </Link>
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-7xl">
          {children}
        </div>
      </body>
    </html>
  );
}
