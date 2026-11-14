import type { ReactNode } from 'react';
import type { MasteryStatus } from '../../core/types';
import { STATUS_LABEL } from '../../core/mastery';
import { toArabicDigits, useQuran } from '../hooks';

export function StatusBadge({ status }: { status: MasteryStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function SurahTitle({ surah, from, to }: { surah: number; from?: number; to?: number }) {
  const q = useQuran();
  const s = q.surah(surah);
  return (
    <span className="surah-title">
      <span className="ar" lang="ar" dir="rtl">{s.nameAr}</span>
      <span>
        {s.nameTr}
        {from != null && <span className="muted"> · {from === to ? from : `${from}–${to}`}</span>}
      </span>
    </span>
  );
}

export function AyahMark({ n }: { n: number }) {
  return <span className="ayah-mark" aria-label={`ayah ${n}`}>{'۝'}{toArabicDigits(n)}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
