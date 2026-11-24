import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { Slot } from '@/lib/types';
import { cn, formatTime, toDateString } from '@/lib/utils';

export function SlotsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => toDateString(new Date(Date.now() + 86_400_000)));
  const [startTime, setStartTime] = useState('09:00');
  const today = toDateString(new Date());
  const maxDate = toDateString(new Date(Date.now() + 60 * 86_400_000));
  const now = new Date();
  now.setSeconds(0, 0);
  if (date === today) now.setMinutes(now.getMinutes() + 1);
  const minTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isFuture = date > today || (date === today && startTime >= minTime);
  const q = useQuery({ queryKey: ['slots', date], queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${date}`), refetchInterval: 15_000 });
  const gen = useMutation({
    mutationFn: () => api.post('/slots/generate', { date, startTime }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['slots'] }); void qc.invalidateQueries({ queryKey: ['slot-dates'] }); },
  });
  return (
    <>
      <PageHeader title="Appointment Slots" subtitle="Add a future 30-minute in-person appointment slot within the next 60 days. Students can select available slots when raising a ticket." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label><span className="label">Date</span><input type="date" min={today} max={maxDate} className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="label">Start time (30 minutes)</span><input type="time" min={date === today ? minTime : undefined} step={60} className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
        <Button loading={gen.isPending} disabled={!isFuture} onClick={() => gen.mutate()}>Add slot</Button>
      </div>
      <ErrorNote error={gen.error} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.slots.length === 0 ? <Empty>No slots for this date yet.</Empty> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {q.data!.slots.map((s) => (
            <div key={s.id} className={cn('rounded-md border p-2 text-xs', s.is_booked ? 'border-brand-orange/50 bg-brand-orange/10' : 'border-line')}>
              <div className="font-bold">{formatTime(s.start_time)}</div>
              <div className="text-ink-muted">{s.is_booked ? `Booked: ${s.booked_by_name ?? 'student'}` : 'Free'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
