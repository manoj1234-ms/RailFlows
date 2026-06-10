import { Link, useNavigate } from 'react-router-dom';
import { Moon, Sun, Menu, X, User, LogOut, Bell, Wallet, LayoutDashboard, Bot } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/Button';


export function Header() {
  const { isAuthenticated, isAdmin, user, theme, toggleTheme, logout } = useAuthStore();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLinks = isAuthenticated
    ? [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/search', label: 'Search', icon: null },
        { to: '/my-trips', label: 'My Trips', icon: null },
        { to: '/wallet', label: 'Wallet', icon: Wallet },
        { to: '/loyalty', label: 'Loyalty', icon: null },
      ]
    : [
        { to: '/', label: 'Home' },
        { to: '/features', label: 'Features' },
        { to: '/pricing', label: 'Pricing' },
        { to: '/about', label: 'About' },
      ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-[var(--color-border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] bg-clip-text text-transparent">
              RailFlow
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {isAuthenticated ? (
              <div className="hidden md:flex items-center gap-3">
                <Link to="/notifications" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                  <Bell size={18} />
                </Link>
                <Link to="/chatbot" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                  <Bot size={18} />
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                    <LayoutDashboard size={18} />
                  </Link>
                )}
                <Link to="/profile" className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <User size={16} />
                  <span className="text-sm">{user?.email?.split('@')[0]}</span>
                </Link>
                <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm">Login</Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Register</Button>
                </Link>
              </div>
            )}

            <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--color-border)] p-4 space-y-3">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {link.label}
            </Link>
          ))}
          {isAuthenticated ? (
            <>
              <Link to="/profile" onClick={() => setMobileOpen(false)} className="block text-sm">Profile</Link>
              {isAdmin && <Link to="/admin" onClick={() => setMobileOpen(false)} className="block text-sm">Admin</Link>}
              <button onClick={handleLogout} className="text-sm text-[var(--color-danger)] cursor-pointer">Logout</button>
            </>
          ) : (
            <div className="flex gap-2 pt-2">
              <Link to="/login" onClick={() => setMobileOpen(false)}><Button variant="ghost" size="sm">Login</Button></Link>
              <Link to="/register" onClick={() => setMobileOpen(false)}><Button size="sm">Register</Button></Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
