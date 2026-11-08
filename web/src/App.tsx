import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RedirectIfAuthed, RequireAuth } from '@/components/Guards';
import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/ui';
import { LoginPage, RegisterPage } from '@/features/auth/AuthPages';
import { useAuth } from '@/features/auth/AuthProvider';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ExamCardPage } from '@/features/exam/ExamCardPage';
import { ApplicationsPage, ExamPeriodsPage, FeeRecordsPage } from '@/features/exam/StaffExamPages';
import { ScanPage } from '@/features/invigilation/ScanPage';
import { UnitsPage } from '@/features/invigilation/UnitsPage';
import { SlotsPage } from '@/features/slots/SlotsPage';
import { VerifyPage } from '@/features/verify/VerifyPage';
import { homeFor } from '@/lib/utils';
import { MyTicketsPage, NewTicketPage, StaffQueuePage, TicketDetailPage } from '@/features/tickets/TicketPages';

// Monaco is large: only download it when staff open the templates page.
const TemplatesPage = lazy(() => import('@/features/templates/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public: invigilators scan the QR code on a printed exam card. No sign-in needed. */}
      <Route path="/verify/:code" element={<VerifyPage />} />

      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />

          <Route element={<RequireAuth roles={['student']} />}>
            <Route path="/tickets" element={<MyTicketsPage />} />
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route path="/exam-card" element={<ExamCardPage />} />
          </Route>

          {/* Exam-hall sign-in: lecturers see only their own units; finance staff and admins see everything. */}
          <Route element={<RequireAuth roles={['lecturer', 'staff', 'admin']} />}>
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/units" element={<UnitsPage />} />
          </Route>

          <Route element={<RequireAuth roles={['staff', 'admin']} />}>
            <Route path="/staff/dashboard" element={<DashboardPage />} />
            <Route path="/staff/queue" element={<StaffQueuePage />} />
            <Route path="/staff/applications" element={<ApplicationsPage />} />
            <Route path="/staff/fee-records" element={<FeeRecordsPage />} />
            <Route path="/staff/exam-periods" element={<ExamPeriodsPage />} />
            <Route path="/staff/slots" element={<SlotsPage />} />
            <Route path="/staff/templates" element={<Suspense fallback={<Spinner />}><TemplatesPage /></Suspense>} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  );
}
