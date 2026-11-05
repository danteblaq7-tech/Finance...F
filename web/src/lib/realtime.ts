import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';

// Tables the database publishes changes for (see database/supabase/schema.sql). Row Level Security still applies:
// a student only receives events for rows they are allowed to read.
const LIVE_TABLES = ['tickets', 'slots', 'exam_card_applications', 'fee_records', 'exam_periods', 'fee_statements'] as const;

/**
 * Live updates: when anyone (a teammate on another laptop, a phone, a staff member…) changes one of the tables above,
 * refetch whatever is on screen. We only use the event as a "something changed" signal and re-read through the API,
 * so the API's permission rules stay the single source of truth.
 * The pages' 15-second polling stays as a safety net if the websocket drops.
 */
export function useRealtimeSync(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several rows can change at once (e.g. generating a day of slots): collapse them into one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries(), 300);
    };
    const channel = supabase.channel('finesse-live');
    for (const table of LIVE_TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
