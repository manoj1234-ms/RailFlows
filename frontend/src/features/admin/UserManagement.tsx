import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const mockUsers = [
  { id: 1, email: 'admin@railflow.app', role: 'Super Admin', status: 'Active', mfa: true },
  { id: 2, email: 'user1@example.com', role: 'Passenger', status: 'Active', mfa: false },
  { id: 3, email: 'operator@railflow.app', role: 'Operator', status: 'Active', mfa: true },
  { id: 4, email: 'agent@example.com', role: 'Agent', status: 'Suspended', mfa: false },
];

export default function UserManagement() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">User Management</h1>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Email</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Role</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Status</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">MFA</th>
              </tr>
            </thead>
            <tbody>
              {mockUsers.map((u) => (
                <tr key={u.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-3">{u.email}</td>
                  <td className="py-3"><Badge variant={u.role === 'Super Admin' ? 'danger' : u.role === 'Admin' ? 'warning' : 'info'}>{u.role}</Badge></td>
                  <td className="py-3"><Badge variant={u.status === 'Active' ? 'success' : 'danger'}>{u.status}</Badge></td>
                  <td className="py-3">{u.mfa ? 'Enabled' : 'Disabled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
