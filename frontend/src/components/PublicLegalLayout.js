import React from 'react';
import { Link } from 'react-router-dom';

export default function PublicLegalLayout({ title, lastUpdated, children }) {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans flex flex-col relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] rounded-full opacity-10 blur-[120px]"
          style={{ background: '#EAB308' }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-[800px] h-[800px] rounded-full opacity-10 blur-[120px]"
          style={{ background: '#6366F1' }}
        />
      </div>

      <header className="relative z-10 pt-8 px-6 sm:px-8 lg:px-12 border-b border-white/10 pb-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <img src="/logo.png?v=2" alt="" className="h-10 w-auto sm:h-11" />
            <span className="font-bold text-lg tracking-tight">Two Loonies</span>
          </Link>
          <Link
            to="/"
            className="text-sm text-slate-400 hover:text-white transition-colors shrink-0"
          >
            Home
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full">
        <article className="max-w-3xl mx-auto px-6 sm:px-8 py-10 sm:py-14">
          {lastUpdated && (
            <p className="text-slate-500 text-sm mb-3">Last updated: {lastUpdated}</p>
          )}
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-8">{title}</h1>
          <div className="legal-doc text-slate-300 text-sm sm:text-[0.9375rem] leading-relaxed space-y-5">
            {children}
          </div>
        </article>
      </main>

      <footer className="relative z-10 border-t border-white/10 mt-auto py-8 px-6 sm:px-8">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">© {new Date().getFullYear()} Two Loonies</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-slate-400 text-sm">
            <Link to="/privacy" className="hover:text-white transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
            <Link to="/legal/subprocessors" className="hover:text-white transition-colors">
              Subprocessors
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
