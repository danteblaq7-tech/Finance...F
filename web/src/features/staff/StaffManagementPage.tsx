import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Empty, ErrorNote, Field, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { UserRole } from '@/lib/types';

type StaffRole = Extract<UserRole, 'staff' | 'admin' | 'lecturer'>;
interface StaffAccount {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
}

interface CreatedStaff {
  email: string;
  temporaryPassword: string;
}

const roleLabels: Record<StaffRole, string> = {
  staff: 'Finance staff',
  admin: 'Admin',
  lecturer: 'Lecturer',
};

const roles: StaffRole[] = ['staff', 'admin', 'lecturer'];

export function StaffManagementPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('staff');
  const [createdStaff, setCreatedStaff] = useState<CreatedStaff | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, StaffRole>>({});

  const staffQuery = useQuery({
    queryKey: ['admin', 'staff'],
    queryFn: () => api.get<{ staff: StaffAccount[] }>('/admin/staff'),
  });
  const createStaff = useMutation({
    mutationFn: () => api.post<{ staff: StaffAccount; temporaryPassword: string }>('/admin/staff', { name, email, role }),
    onSuccess: ({ staff, temporaryPassword }) => {
      setCreatedStaff({ email: staff.email, temporaryPassword });
      setName('');
      setEmail('');
      setRole('staff');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
  const updateStaff = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: { role?: StaffRole; isActive?: boolean } }) =>
      api.patch<{ staff: StaffAccount }>(`/admin/staff/${id}`, changes),
    onSuccess: (_result, { id }) => {
      setRoleDrafts((drafts) => {
        const next = { ...drafts };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatedStaff(null);
    createStaff.mutate();
  }

  return (
    <div>
      <PageHeader title="Staff management" subtitle="Create staff accounts and manage staff roles and access." />

      <section className="card mb-6 space-y-4" aria-labelledby="create-staff-heading">
        <div>
          <h2 id="create-staff-heading" className="text-base font-bold">Create staff account</h2>
          <p className="mt-1 text-sm text-ink-secondary">A temporary password is generated. The new user must change it at first login.</p>
        </div>
        <form className="grid gap-3 md:grid-cols-4 md:items-end" onSubmit={submitCreate}>
          <Field label="Name">
            <input className="input" autoComplete="name" required minLength={2} maxLength={150} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" autoComplete="email" required maxLength={190} value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Role">
            <select className="input" value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
              {roles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
            </select>
          </Field>
          <Button type="submit" loading={createStaff.isPending}>Create account</Button>
        </form>
        <ErrorNote error={createStaff.error} />
        {createdStaff && (
          <div role="status" className="rounded-md border border-brand-teal/40 bg-brand-teal/10 p-4">
            <div className="font-bold">Account created for {createdStaff.email}</div>
            <p className="mt-1 text-sm">Share this temporary password securely. It is shown only once; the user must change it at first login.</p>
            <code className="mt-2 block select-all break-all rounded bg-bg-primary p-2 font-mono text-sm">{createdStaff.temporaryPassword}</code>
            <Button className="mt-3" variant="secondary" onClick={() => setCreatedStaff(null)}>Dismiss password</Button>
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="staff-list-heading">
        <div>
          <h2 id="staff-list-heading" className="text-base font-bold">Staff accounts</h2>
          <p className="mt-1 text-sm text-ink-secondary">Manage finance staff, admins and lecturers.</p>
        </div>
        {staffQuery.isLoading ? <Spinner label="Loading staff accounts…" /> : null}
        <ErrorNote error={staffQuery.error} />
        {staffQuery.data?.staff.length === 0 && <Empty>No staff accounts found.</Empty>}
        {staffQuery.data && staffQuery.data.staff.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-bg-tertiary text-xs uppercase text-ink-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3">Name / email</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {staffQuery.data.staff.map((account) => {
                  const roleDraft = roleDrafts[account.id] ?? account.role;
                  return (
                    <tr key={account.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{account.name}</div>
                        <div className="text-xs text-ink-secondary">{account.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            className="input min-w-36"
                            aria-label={`Role for ${account.email}`}
                            value={roleDraft}
                            onChange={(event) => setRoleDrafts((drafts) => ({ ...drafts, [account.id]: event.target.value as StaffRole }))}
                          >
                            {roles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
                          </select>
                          {roleDraft !== account.role && (
                            <Button
                              variant="secondary"
                              loading={updateStaff.isPending}
                              onClick={() => updateStaff.mutate({ id: account.id, changes: { role: roleDraft } })}
                            >
                              Save role
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={account.is_active ? 'text-brand-teal-lt' : 'text-brand-red'}>
                          {account.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant={account.is_active ? 'danger' : 'secondary'}
                          loading={updateStaff.isPending}
                          onClick={() => updateStaff.mutate({ id: account.id, changes: { isActive: !account.is_active } })}
                        >
                          {account.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={updateStaff.error} />
      </section>
    </div>
  );
}
