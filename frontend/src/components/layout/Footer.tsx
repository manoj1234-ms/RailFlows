import { Link } from 'react-router-dom';

const footerLinks = [
  { title: 'Company', links: [{ label: 'About', to: '/about' }, { label: 'Careers', to: '/careers' }, { label: 'Blog', to: '/blog' }] },
  { title: 'Support', links: [{ label: 'Help Center', to: '/support' }, { label: 'FAQ', to: '/faq' }, { label: 'Contact', to: '/contact' }] },
  { title: 'Legal', links: [{ label: 'Privacy', to: '/privacy' }, { label: 'Terms', to: '/terms' }] },
];

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <span className="text-xl font-bold bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] bg-clip-text text-transparent">
              RailFlow
            </span>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              India's premium train booking platform with AI-powered recommendations and real-time tracking.
            </p>
          </div>
          {footerLinks.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold mb-3">{group.title}</h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 pt-8 border-t border-[var(--color-border)] text-center text-sm text-[var(--color-text-muted)]">
          &copy; {new Date().getFullYear()} RailFlow. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
