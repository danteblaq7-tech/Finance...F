/** Shown instead of the app when web/.env is missing or still has the template's placeholder values. */
export function SetupNeeded() {
  return (
    <div style={{ fontFamily: "Lexend, system-ui, sans-serif", maxWidth: 560, margin: '12vh auto', padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8, fontFamily: 'Orbitron, system-ui, sans-serif' }}>Finesse needs its Supabase settings</h1>
      <p>This app signs in and receives live updates through your team&apos;s Supabase project, but it doesn&apos;t know which one yet.</p>
      <ol style={{ paddingLeft: 20 }}>
        <li>Copy <code>web/.env.example</code> to <code>web/.env</code>.</li>
        <li>
          Fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Supabase dashboard ▸ Project Settings ▸ API,
          or ask the project owner).
        </li>
        <li>Stop and restart <code>npm run dev</code>. Vite only reads <code>.env</code> at startup.</li>
      </ol>
      <p style={{ color: '#64748B', fontSize: 13 }}>Full walkthrough: README → &ldquo;Supabase setup&rdquo;.</p>
    </div>
  );
}
