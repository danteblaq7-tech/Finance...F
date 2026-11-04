import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { Slot } from '@/lib/types';
import { cn, formatTime, toDateString } from '@/lib/utils';

export function SlotsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => toDateString(new Date(Date.now() + 86_400_000)));
  const q = useQuery({ queryKey: ['slots', date], queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${date}`), refetchInterval: 15_000 });
  const gen = useMutation({
    mutationFn: () => api.post('/slots/generate', { date }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['slots'] }); void qc.invalidateQueries({ queryKey: ['slot-dates'] }); },
  });
  return (
    <>
      <PageHeader title="Appointment Slots" subtitle="30-minute slots, 08:00–17:00. Generating a date that already has slots does nothing." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label><span className="label">Date</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <Button loading={gen.isPending} onClick={() => gen.mutate()}>Generate slots</Button>
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
