import Editor from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, ErrorNote, Field, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { EmailTemplate, SentEmail } from '@/lib/types';
import { cn, formatDateTime, renderTemplate } from '@/lib/utils';

const SAMPLE = { to_name: 'Amina Hassan', semester: 'Semester 1', academic_year: '2026/2027', card_number: 'FC-A1B2C3D4', reason: 'Your fees are not fully cleared. Outstanding balance: KSh 26,000.' };
const LABELS = { exam_card: 'Exam card email', rejection: 'Rejection email' } as const;

function TemplateEditor({ template }: { template: EmailTemplate }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [html, setHtml] = useState(template.html);
  const dirty = subject !== template.subject || html !== template.html;
  const save = useMutation({
    mutationFn: () => api.put(`/templates/${template.template_key}`, { subject, html }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['templates'] }); },
  });
  return (
    <div className="space-y-3">
      <Field label="Subject" hint="Placeholders: {{to_name}} {{semester}} {{academic_year}} {{card_number}} {{reason}}">
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="label">HTML (Monaco editor)</div>
          <div className="overflow-hidden rounded-md border border-line">
            <Editor height="340px" defaultLanguage="html" theme={document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'}
              value={html} onChange={(v) => setHtml(v ?? '')} options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 13, scrollBeyondLastLine: false }} loading={<Spinner label="Loading editor…" />} />
          </div>
        </div>
        <div>
          <div className="label">Live preview (sample data)</div>
          {/* sandbox="" blocks scripts, so a template can never run code in the staff member's session */}
          <iframe title="Template preview" sandbox="" srcDoc={renderTemplate(html, SAMPLE)} className="h-[340px] w-full rounded-md border border-line bg-white" />
        </div>
      </div>
      <ErrorNote error={save.error} />
      <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{save.isSuccess && !dirty ? 'Saved ✓' : 'Save template'}</Button>
    </div>
  );
}

export function TemplatesPage() {
  const [key, setKey] = useState<'exam_card' | 'rejection'>('exam_card');
  const [viewing, setViewing] = useState<string | null>(null);
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<{ templates: EmailTemplate[] }>('/templates') });
  const emails = useQuery({ queryKey: ['emails'], queryFn: () => api.get<{ emails: SentEmail[] }>('/emails') });
  const viewed = useQuery({ queryKey: ['email', viewing], enabled: !!viewing, queryFn: () => api.get<{ email: SentEmail }>(`/emails/${viewing}`) });
  const current = templates.data?.templates.find((t) => t.template_key === key);
  return (
    <>
      <PageHeader title="Email Templates" subtitle="Edit the emails sent to students. Values are HTML-escaped when filled in." />
      <div className="mb-4 flex gap-2">
        {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((k) => (
          <button key={k} onClick={() => setKey(k)} className={cn('rounded-md border px-3 py-1 text-xs font-bold uppercase', key === k ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line text-ink-secondary')}>{LABELS[k]}</button>
        ))}
      </div>
      {templates.isLoading ? <Spinner /> : templates.error ? <ErrorNote error={templates.error} /> : current && <TemplateEditor key={`${current.template_key}-${current.updated_at}`} template={current} />}

      <h2 className="mb-3 mt-10 text-base font-bold">Sent emails (outbox)</h2>
      {emails.isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {emails.data?.emails.map((e) => (
            <button key={e.id} onClick={() => setViewing(e.id)} className="card flex w-full flex-wrap items-center justify-between gap-2 text-left hover:border-line-active">
              <span><span className="font-bold">{e.to_name ?? e.to_email}</span> <span className="text-ink-muted">· {e.email_type === 'exam_card' ? `Exam card ${e.card_number ?? ''}` : 'Rejection'} · {formatDateTime(e.sent_at)}</span></span>
              <Badge color={e.delivered ? '#22C55E' : '#F59E0B'}>{e.delivered ? 'DELIVERED' : 'STORED ONLY'}</Badge>
            </button>
          ))}
          {viewing && viewed.data && (
            <div className="card">
              <div className="mb-2 flex justify-between"><div className="label">{viewed.data.email.to_email}</div><button onClick={() => setViewing(null)} className="text-xs underline">Close</button></div>
              <iframe title="Sent email" sandbox="" srcDoc={viewed.data.email.html} className="h-64 w-full rounded-md border border-line bg-white" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
