'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, ErrorNote, LoadingRow, formatDate } from '@/components/ui';
import { useSession } from '@/lib/session';

interface SampleRow {
  id: string;
  subject: string;
  provenance: string;
  parseStatus: string;
  score: number;
  priority: string | null;
  unknownCount: number;
  createdAt: string;
}

const PRIORITY_TONES: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

export default function EmailRiskReviewPage() {
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const readOnly = actor?.role === 'AUDITOR';

  const { data, isLoading } = useQuery({
    queryKey: ['email-samples'],
    queryFn: () => api<{ items: SampleRow[] }>('/email-samples?limit=50'),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const response = await fetch('/api/v1/email-samples', {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          'x-csrf-token': document.cookie.match(/(?:^|;\s*)bb_csrf=([^;]+)/)?.[1] ?? '',
        },
        body: buffer,
        credentials: 'same-origin',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? `Upload failed (HTTP ${response.status})`);
      }
      return body as { sampleId: string; score: number; priority: string | null; replay: boolean };
    },
    onSuccess: (result) => {
      setUploadError(null);
      setUploadOk(
        result.replay
          ? 'This sample was already analyzed — showing the stored analysis.'
          : `Analyzed: score ${result.score}, priority ${result.priority ?? 'none'}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['email-samples'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (e) => {
      setUploadOk(null);
      setUploadError(e instanceof Error ? e.message : 'Upload failed.');
    },
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Email Risk Review</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Upload a suspicious <span className="font-mono text-xs">.eml</span> (≤ 2 MiB). Parsing is bounded and
          provenance-aware: uploaded messages are <strong>RAW_UPLOAD</strong>, so claimed SPF/DKIM/DMARC results are
          recorded as untrusted claims — never as verified authentication. Every finding carries a reason code,
          severity and redacted evidence.
        </p>
      </section>

      <Card title="Upload a message" action={<span className="text-xs text-slate-500">Synthetic .eml only — never real correspondence</span>}>
        {readOnly ? (
          <p className="text-sm text-slate-500">Auditors have read-only access to this workspace.</p>
        ) : (
          <div className="space-y-3">
            <input
              ref={fileInput}
              type="file"
              accept=".eml,message/rfc822"
              className="block w-full max-w-md cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-navy-950 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-navy-800"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
              }}
              disabled={upload.isPending}
              aria-label="Email sample file"
            />
            {upload.isPending && <p className="text-sm text-slate-500">Analyzing…</p>}
            {uploadOk && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{uploadOk}</p>}
            {uploadError && <ErrorNote message={uploadError} />}
            <p className="text-xs text-slate-500">
              Fixture samples live in <span className="font-mono">fixtures/emails/</span> in the repository — try
              <span className="font-mono"> S02</span> (supplier lookalike + bank-change language) or
              <span className="font-mono"> M05</span> (unsafe HTML).
            </p>
          </div>
        )}
      </Card>

      <Card title="Analyzed samples">
        {isLoading ? (
          <DataTable headers={['Subject', 'Provenance', 'Parse', 'Score', 'Priority', 'Analyzed']}>
            <LoadingRow colSpan={6} />
          </DataTable>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No email samples yet"
            description="Upload a .eml above to run the bounded parser and BEC-01…07 rule evaluation."
          />
        ) : (
          <DataTable headers={['Subject', 'Provenance', 'Parse', 'Score', 'Priority', 'Analyzed']}>
            {data!.items.map((sample) => (
              <tr key={sample.id} className="hover:bg-slate-50">
                <td className="max-w-[22rem] truncate px-3 py-2">
                  <Link href={`/emails/${sample.id}`} className="font-medium text-info-500 hover:underline">
                    {sample.subject}
                  </Link>
                </td>
                <td className="px-3 py-2"><Badge tone="neutral">{sample.provenance.replaceAll('_', ' ')}</Badge></td>
                <td className="px-3 py-2 text-slate-600">{sample.parseStatus}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{sample.score}</td>
                <td className="px-3 py-2">
                  {sample.priority ? <Badge tone={PRIORITY_TONES[sample.priority] ?? 'low'}>{sample.priority}</Badge> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(sample.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
