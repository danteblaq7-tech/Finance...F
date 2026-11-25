import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Empty, ErrorNote, Field, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

interface StudentAccount {
  id: string;
  name: string;
  email: string;
  student_id: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

interface StudentPage {
  students: StudentAccount[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface RegisteredStudent {
  student_number: string;
  units: string[];
}

interface RegisteredStudentPage {
  students: RegisteredStudent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  : 'Not available';

export function StudentAccountsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [registeredPage, setRegisteredPage] = useState(1);
  const [tab, setTab] = useState<'accounts' | 'registered'>('accounts');
  const [deactivating, setDeactivating] = useState<StudentAccount | null>(null);
  const [reason, setReason] = useState('');
  const [resetSent, setResetSent] = useState<string | null>(null);

  const studentsQuery = useQuery({
    queryKey: ['admin', 'students', search, status, page],
    queryFn: () => api.get<StudentPage>(
      `/admin/students?q=${encodeURIComponent(search)}&status=${status}&page=${page}&pageSize=25`,
    ),
  });
  const registeredQuery = useQuery({
    queryKey: ['admin', 'students', 'registered-not-signed-up', registeredPage],
    enabled: tab === 'registered',
    queryFn: () => api.get<RegisteredStudentPage>(
      `/admin/students/registered-not-signed-up?page=${registeredPage}&pageSize=25`,
    ),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
  const updateStudent = useMutation({
    mutationFn: ({ student, isActive, reason: deactivationReason }: {
      student: StudentAccount;
      isActive: boolean;
      reason?: string;
    }) => api.patch<{ student: StudentAccount }>(`/admin/students/${student.id}`, {
      isActive,
      ...(deactivationReason ? { reason: deactivationReason } : {}),
    }),
    onSuccess: () => {
      setDeactivating(null);
      setReason('');
      void refresh();
    },
  });
  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/admin/students/${id}/password-reset`, {}),
    onSuccess: (_result, id) => {
      const email = studentsQuery.data?.students.find((student) => student.id === id)?.email;
      setResetSent(email ?? 'the student');
    },
  });

  function applySearch(value: string) {
    setSearch(value.trim());
    setPage(1);
  }

  const pageData = studentsQuery.data;

  return (
    <div>
      <PageHeader
        title="Student accounts"
        subtitle={isAdmin ? 'Search accounts and manage access. Financial records are not shown here.' : 'Read-only student account directory.'}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Student account lists">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'accounts'}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold aria-selected:border-line-active aria-selected:bg-bg-tertiary"
          onClick={() => setTab('accounts')}
        >
          Student accounts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'registered'}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold aria-selected:border-line-active aria-selected:bg-bg-tertiary"
          onClick={() => setTab('registered')}
        >
          Registered, not signed up
        </button>
      </div>

      {tab === 'accounts' && (
      <>
      <section className="card mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end" aria-label="Student account filters">
        <Field label="Search name, email or student number">
          <input
            className="input"
            type="search"
            maxLength={100}
            placeholder="e.g. COM/072/23"
            value={search}
            onChange={(event) => applySearch(event.target.value)}
          />
        </Field>
        <Field label="Account status">
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All students</option>
            <option value="active">Active accounts</option>
            <option value="inactive">Inactive accounts</option>
          </select>
        </Field>
      </section>

      {studentsQuery.isLoading ? <Spinner label="Loading student accounts…" /> : null}
      <ErrorNote error={studentsQuery.error} />
      {pageData?.students.length === 0 && <Empty>No student accounts match these filters.</Empty>}

      {pageData && pageData.students.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-bg-tertiary text-xs uppercase text-ink-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3">Student</th>
                  <th scope="col" className="px-4 py-3">Student number</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3">Last sign-in</th>
                  {isAdmin && <th scope="col" className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageData.students.map((student) => (
                  <tr key={student.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{student.name}</div>
                      <div className="text-xs text-ink-secondary">{student.email}</div>
                    </td>
                    <td className="px-4 py-3">{student.student_id ?? 'Not available'}</td>
                    <td className="px-4 py-3">
                      <span className={student.is_active ? 'text-brand-teal-lt' : 'text-brand-red'}>
                        {student.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{dateLabel(student.created_at)}</td>
                    <td className="px-4 py-3">{dateLabel(student.last_sign_in_at)}</td>
                    {isAdmin && (
                      <td className="space-x-2 px-4 py-3">
                        <Button
                          variant={student.is_active ? 'danger' : 'secondary'}
                          onClick={() => {
                            if (student.is_active) {
                              setDeactivating(student);
                              setReason('');
                            } else {
                              updateStudent.mutate({ student, isActive: true });
                            }
                          }}
                        >
                          {student.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button
                          variant="secondary"
                          loading={resetPassword.isPending}
                          onClick={() => {
                            setResetSent(null);
                            resetPassword.mutate(student.id);
                          }}
                        >
                          Send password reset
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <span className="text-sm text-ink-secondary">
              {pageData.total} students · Page {pageData.page} of {Math.max(pageData.totalPages, 1)}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pageData.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {deactivating && (
        <form
          className="card mt-6 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            updateStudent.mutate({ student: deactivating, isActive: false, reason });
          }}
        >
          <h2 className="font-bold">Deactivate {deactivating.name}</h2>
          <p className="text-sm text-ink-secondary">This immediately blocks API and direct database access. Student records are preserved.</p>
          <Field label="Reason (required)">
            <input className="input" minLength={5} maxLength={300} required value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={updateStudent.isPending}>Confirm deactivation</Button>
            <Button type="button" variant="secondary" onClick={() => setDeactivating(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {resetSent && <p role="status" className="mt-4 text-sm text-brand-teal-lt">Password-reset email sent to {resetSent}.</p>}
      <ErrorNote error={updateStudent.error ?? resetPassword.error} />
      </>
      )}

      {tab === 'registered' && (
        <section role="tabpanel" aria-label="Registered, not signed up">
          {registeredQuery.isLoading ? <Spinner label="Loading registered students…" /> : null}
          <ErrorNote error={registeredQuery.error} />
          {registeredQuery.data?.students.length === 0 && <Empty>No registered student numbers are missing accounts.</Empty>}
          {registeredQuery.data && registeredQuery.data.students.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-bg-tertiary text-xs uppercase text-ink-secondary">
                    <tr>
                      <th scope="col" className="px-4 py-3">Student number</th>
                      <th scope="col" className="px-4 py-3">Registered units</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {registeredQuery.data.students.map((student) => (
                      <tr key={student.student_number}>
                        <td className="px-4 py-3 font-semibold">{student.student_number}</td>
                        <td className="px-4 py-3">{student.units.length ? student.units.join(', ') : 'No unit registrations'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4">
                <span className="text-sm text-ink-secondary">
                  {registeredQuery.data.total} students · Page {registeredQuery.data.page} of {Math.max(registeredQuery.data.totalPages, 1)}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={registeredPage <= 1} onClick={() => setRegisteredPage((value) => value - 1)}>Previous</Button>
                  <Button variant="secondary" disabled={registeredPage >= registeredQuery.data.totalPages} onClick={() => setRegisteredPage((value) => value + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}