begin;

create table if not exists public.ticket_classification_recommendations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  suggested_category text not null check (
    suggested_category in ('fee_dispute', 'payment_plan', 'sponsorship', 'helb', 'bursary', 'fee_statement', 'other')
  ),
  suggested_priority text not null check (suggested_priority in ('low', 'medium', 'high')),
  rationale text not null check (length(btrim(rationale)) between 1 and 500),
  provider_name text not null check (length(btrim(provider_name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_classification_recommendations_latest
  on public.ticket_classification_recommendations (ticket_id, created_at desc, id desc);

alter table public.ticket_classification_recommendations enable row level security;
revoke all on public.ticket_classification_recommendations from public, anon, authenticated;

commit;
