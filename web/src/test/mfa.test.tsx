import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaPage } from '@/features/auth/MfaPage';

const mocks = vi.hoisted(() => ({
  role: 'staff' as 'staff' | 'admin' | 'student' | 'lecturer',
  get: vi.fn(),
  post: vi.fn(),
  refreshProfile: vi.fn(),
  navigate: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'mfa-user', name: 'Finance Officer', email: 'staff@example.test', role: mocks.role, mfa: { enrolled: true, required: true, assuranceLevel: 'aal1' } },
    refreshProfile: mocks.refreshProfile,
  }),
}));

vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { mfa: { enroll: mocks.enroll, challengeAndVerify: mocks.challengeAndVerify } } },
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/staff/mfa']}>
      <Routes>
        <Route path="/staff/mfa" element={<MfaPage />} />
        <Route path="/staff/queue" element={<div>Staff queue</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('staff two-factor authentication', () => {
  beforeEach(() => {
    mocks.role = 'staff';
    mocks.get.mockReset().mockResolvedValue({
      mfa: { enrolled: true, required: true, assuranceLevel: 'aal1', factorId: 'totp-1' },
    });
    mocks.post.mockReset().mockResolvedValue({ mfa: { enrolled: true } });
    mocks.refreshProfile.mockReset().mockResolvedValue({ role: 'staff', mfa: { required: true, assuranceLevel: 'aal2' } });
    mocks.navigate.mockReset();
    mocks.enroll.mockReset();
    mocks.challengeAndVerify.mockReset().mockResolvedValue({ error: null });
  });

  it('requires a current TOTP code before continuing an enrolled staff session', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'totp-1', code: '123456' }));
    expect(await screen.findByText(/ask another admin to reset your authenticator/i)).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith('/staff/dashboard', { replace: true });
  });

  it('supports QR enrollment and records it only after successful Supabase verification', async () => {
    mocks.get.mockResolvedValue({
      mfa: { enrolled: false, required: true, assuranceLevel: 'aal1', factorId: null },
    });
    mocks.enroll.mockResolvedValue({
      data: { id: 'new-factor', totp: { uri: 'otpauth://totp/Finesse?secret=secret', secret: 'secret' } },
      error: null,
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByRole('img', { name: /qr code/i })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }));
    await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new-factor', code: '654321' }));
    expect(mocks.post).toHaveBeenCalledWith('/auth/mfa/begin-enrollment');
    expect(mocks.post).toHaveBeenCalledWith('/auth/mfa/complete-enrollment');
    expect(mocks.navigate).toHaveBeenCalledWith('/staff/dashboard', { replace: true });
  });
});
