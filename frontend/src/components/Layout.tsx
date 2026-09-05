import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { APP_NAME, APP_NAME_PARTS } from '../lib/brand'
import { useAuth, useTheme } from '../lib/hooks'
import { useLeague } from '../lib/league'
import { PoweredBy } from '../pages/Home'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/leagues', label: 'Leagues' },
  { to: '/live', label: 'Live' },
  { to: '/register', label: 'Register' },
  { to: '/contact', label: 'Contact' },
]

export function Layout() {
  const { cycle, next } = useTheme()
  const { email, signOut } = useAuth()
  const { league } = useLeague()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-amber focus:px-3 focus:py-2"
        style={{ color: 'var(--on-accent)' }}
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-pitch/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-baseline gap-2" onClick={() => setOpen(false)}>
            <span className="font-display text-2xl font-black uppercase leading-none tracking-tightest">
              {APP_NAME_PARTS.lead} <span className="text-amber">{APP_NAME_PARTS.rest}</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-sm px-3 py-2 font-mono text-[0.68rem] uppercase tracking-eyebrow transition ${
                    isActive ? 'text-amber' : 'text-muted hover:text-ink'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button
              type="button"
              onClick={cycle}
              className="btn-ghost !px-3 !py-2"
              aria-label={`Switch to the ${next.label} palette — ${next.hint}`}
              title={next.hint}
            >
              {next.label}
            </button>
            {email ? (
              <div className="hidden items-center gap-2 sm:flex">
                <Link to="/admin" className="btn-primary !px-3 !py-2">
                  Console
                </Link>
                <button type="button" onClick={signOut} className="btn-ghost !px-3 !py-2">
                  Sign out
                </button>
              </div>
            ) : (
              <Link to="/admin/login" className="hidden btn-ghost !px-3 !py-2 sm:inline-flex">
                Admin
              </Link>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="btn-ghost !px-3 !py-2 md:hidden"
              aria-expanded={open}
            >
              {open ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-line md:hidden">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block border-b border-line px-5 py-3 font-mono text-xs uppercase tracking-eyebrow ${
                    isActive ? 'text-amber' : 'text-muted'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <Link
              to={email ? '/admin' : '/admin/login'}
              onClick={() => setOpen(false)}
              className="block px-5 py-3 font-mono text-xs uppercase tracking-eyebrow text-amber"
            >
              {email ? 'Auction console' : 'Admin sign in'}
            </Link>
          </nav>
        )}
      </header>

      <main id="main" key={location.pathname} className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="font-display text-xl uppercase tracking-tightest">{APP_NAME}</p>
            <p className="mt-1 text-xs text-muted">
              Live player auctions for district and corporate cricket leagues.
            </p>
          </div>
          {league && (league.powered_by_name || league.powered_by_logo_url) ? (
            <PoweredBy league={league} />
          ) : (
            <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
              Built for the room, the stream and the phone in the stands
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}
