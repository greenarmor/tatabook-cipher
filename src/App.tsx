import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';

import { db } from './firebase.ts';

interface Word {
  token: string;
  normalized?: string;
  start_ms: number;
  end_ms: number;
}

interface PuzzleDoc {
  title?: string;
  video_id?: string;
  hint?: string;
  transcript?: { version?: number; sha256?: string; words?: Word[] };
  cipher?: { version?: number; transcript_sha256?: string; tokens?: number[] };
  created_at?: number;
  published_by?: string;
}

interface Puzzle {
  slug: string;
  data: PuzzleDoc;
}

function slugFromHash(): string | null {
  const match = window.location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  return match ? match[1] : null;
}

function stamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function cueTime(ms: number, separator: string): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(millis, 3)}`;
}

function toSrt(words: Word[]): string {
  const blocks = words.map(
    (word, index) =>
      `${index + 1}\n${cueTime(word.start_ms, ',')} --> ${cueTime(word.end_ms, ',')}\n${word.token}`,
  );
  return `${blocks.join('\n\n')}\n`;
}

function toVtt(words: Word[]): string {
  const blocks = words.map(
    (word) =>
      `${cueTime(word.start_ms, '.')} --> ${cueTime(word.end_ms, '.')}\n${word.token}`,
  );
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

function saveFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function transcriptLines(words: Word[]): { at: string; text: string }[] {
  const blocks: { at: string; text: string }[] = [];
  let bucket: string[] = [];
  let start = 0;
  for (const word of words) {
    if (bucket.length === 0) start = word.start_ms;
    bucket.push(word.token);
    if (bucket.length >= 14 || word.end_ms - start >= 12_000) {
      blocks.push({ at: stamp(start), text: bucket.join(' ') });
      bucket = [];
    }
  }
  if (bucket.length > 0) blocks.push({ at: stamp(start), text: bucket.join(' ') });
  return blocks;
}

function initial(word: Word): string {
  const normalized = (word.normalized ?? '').toLowerCase();
  return normalized ? normalized[0].toUpperCase() : '·';
}

function postedAt(value?: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function PuzzleView({
  slug,
  onBack,
}: {
  slug: string;
  onBack: () => void;
}) {
  const [puzzle, setPuzzle] = useState<PuzzleDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [showInitials, setShowInitials] = useState(false);
  const [view, setView] = useState<'words' | 'text'>('words');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'edu_puzzles', slug), (snap) => {
      if (snap.exists()) setPuzzle(snap.data() as PuzzleDoc);
      else setMissing(true);
    });
    return () => unsub();
  }, [slug]);

  if (missing) {
    return (
      <div className="py-10 text-center">
        <div className="text-sm text-slate-300">This puzzle does not exist.</div>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-xs text-fuchsia-300 hover:text-fuchsia-200"
        >
          back to puzzles
        </button>
      </div>
    );
  }

  if (!puzzle) {
    return (
      <div className="py-10 text-center text-sm text-slate-400">opening…</div>
    );
  }

  const words = puzzle.transcript?.words ?? [];
  const tokens = puzzle.cipher?.tokens ?? [];
  const digest = puzzle.transcript?.sha256 ?? puzzle.cipher?.transcript_sha256 ?? '';
  const answer = tokens
    .map((token, position) => {
      if (token === 0) return ' ';
      const word = words[token - 1];
      if (!word) return '?';
      return revealed.has(position) ? initial(word) : '·';
    })
    .join('');

  const revealAt = (position: number) => {
    setRevealed((current) => {
      const next = new Set(current);
      next.add(position);
      return next;
    });
  };

  const nextHidden = () => {
    const position = tokens.findIndex(
      (token, index) => token !== 0 && !revealed.has(index),
    );
    if (position >= 0) revealAt(position);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-white">
            {puzzle.title ?? slug}
          </h1>
          <div className="mt-1 text-[11px] text-slate-500">
            {words.length} words · {tokens.length} tokens
            {puzzle.created_at ? ` · ${postedAt(puzzle.created_at)}` : ''}
            {digest ? (
              <>
                {' · digest '}
                <span className="font-mono">{digest.slice(0, 12)}…</span>
              </>
            ) : null}
          </div>
          {puzzle.video_id ? (
            <a
              className="mt-2 inline-block text-[11px] text-fuchsia-300 hover:text-fuchsia-200"
              href={`https://www.youtube.com/watch?v=${puzzle.video_id}`}
              target="_blank"
              rel="noreferrer"
            >
              watch the recording ↗
            </a>
          ) : null}
        </div>
        <button type="button" onClick={onBack} className="m-btn-text">
          all puzzles
        </button>
      </div>

      <section className="m-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
            Cipher
          </h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={nextHidden} className="m-btn-filled">
              reveal next
            </button>
            <button
              type="button"
              onClick={() =>
                setRevealed(new Set(tokens.map((_, index) => index)))
              }
              className="m-btn-tonal"
            >
              reveal all
            </button>
            <button
              type="button"
              onClick={() => setRevealed(new Set())}
              className="m-btn-text"
            >
              reset
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {tokens.map((token, position) => (
            <button
              key={position}
              type="button"
              onClick={() => token !== 0 && revealAt(position)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                token === 0
                  ? 'border-slate-700 bg-slate-800/60 text-slate-500'
                  : revealed.has(position)
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20'
              }`}
              title={
                token === 0
                  ? 'space'
                  : `word ${token}${revealed.has(position) ? '' : ' — click to reveal'}`
              }
            >
              {token === 0
                ? '␣'
                : revealed.has(position)
                  ? `${token} ${words[token - 1] ? initial(words[token - 1]) : '?'}`
                  : token}
            </button>
          ))}
        </div>
        <div className="m-scroll mt-3 overflow-x-auto rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <div className="whitespace-pre font-mono text-sm tracking-[0.25em] text-slate-100">
            {answer}
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Each number is a <span className="text-slate-300">word number</span> —
          row # in the book below, not a timecode. The letter is that word’s
          initial; zero is a space. Reveal tokens one by one, or work it out
          from the book yourself.
        </p>
        {[...revealed].filter((position) => tokens[position] !== 0).length > 0 && (
          <div className="m-scroll mt-3 max-h-40 overflow-y-auto rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              steps
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-400">
              {tokens.map((token, position) =>
                token !== 0 && revealed.has(position) ? (
                  <li key={position}>
                    <span className="text-slate-500">#{token}</span>{' '}
                    <span className="text-slate-300">
                      {words[token - 1]?.token ?? '?'}
                    </span>{' '}
                    <span className="text-slate-600">
                      @{words[token - 1] ? stamp(words[token - 1].start_ms) : '?'}
                    </span>{' '}
                    →{' '}
                    <span className="text-emerald-200">
                      {words[token - 1] ? initial(words[token - 1]) : '?'}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
        {puzzle.hint && (
          <p className="mt-2 text-xs text-amber-200">hint: {puzzle.hint}</p>
        )}
      </section>

      <section className="m-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
              The book
            </h2>
            <p className="mt-1 text-[10px] text-slate-500">
              {words.length} words
              {digest ? ` · digest ${digest.slice(0, 12)}…` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setView('words')}
              className={`m-btn-text ${view === 'words' ? '!text-white' : ''}`}
            >
              word list
            </button>
            <button
              type="button"
              onClick={() => setView('text')}
              className={`m-btn-text ${view === 'text' ? '!text-white' : ''}`}
            >
              read
            </button>
            {view === 'words' && (
              <button
                type="button"
                onClick={() => setShowInitials((value) => !value)}
                className="m-btn-text"
              >
                {showInitials ? 'hide initials' : 'show initials'}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                saveFile(
                  'transcript.json',
                  JSON.stringify(
                    {
                      version: puzzle.transcript?.version ?? 1,
                      sha256: digest,
                      words,
                    },
                    null,
                    2,
                  ),
                  'application/json',
                )
              }
              className="m-btn-text"
            >
              .json
            </button>
            <button
              type="button"
              onClick={() => saveFile('transcript.srt', toSrt(words), 'application/x-subrip')}
              className="m-btn-text"
            >
              .srt
            </button>
            <button
              type="button"
              onClick={() => saveFile('transcript.vtt', toVtt(words), 'text/vtt')}
              className="m-btn-text"
            >
              .vtt
            </button>
          </div>
        </div>
        {showInitials && (
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            initial = first letter of the word’s longest letter-run, lowercased
            (I’ve → ve → V); words with no letters show — and can never be
            pointed at.
          </p>
        )}
        {view === 'text' ? (
          <div className="m-scroll mt-3 max-h-[60vh] overflow-y-auto rounded-xl bg-[var(--color-surface-2)] p-3">
            <ol className="space-y-2 text-xs leading-relaxed text-slate-300">
              {transcriptLines(words).map((line, index) => (
                <li key={index} className="flex gap-3">
                  <span className="w-12 shrink-0 font-mono text-[10px] text-slate-500">
                    {line.at}
                  </span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
        <div className="m-scroll mt-3 max-h-[60vh] overflow-auto">
          <table className="m-table">
            <thead className="sticky top-0 bg-[var(--color-surface-1)]">
              <tr>
                <th>word #</th>
                <th>word</th>
                <th>time</th>
                {showInitials && <th>initial</th>}
              </tr>
            </thead>
            <tbody>
              {words.map((word, index) => (
                <tr key={index}>
                  <td className="font-mono text-[11px] text-slate-500">
                    {index + 1}
                  </td>
                  <td className="text-slate-200">{word.token}</td>
                  <td className="font-mono text-[11px] text-slate-500">
                    {stamp(word.start_ms)}
                  </td>
                  {showInitials && (
                    <td className="font-mono text-[11px]">
                      <span className="text-fuchsia-200">{initial(word)}</span>
                      <span className="ml-2 text-[10px] text-slate-500">
                        {word.normalized || '—'}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <section className="m-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
          The rule
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-400">
          <li>
            The message is letters A–Z and spaces. A space is token
            <span className="font-mono"> 0</span>.
          </li>
          <li>
            To encode, walk the book forward: each letter picks the next unused
            word that starts with it. Indices strictly increase, so no word is
            reused.
          </li>
          <li>
            A word’s letter key is the first letter of its longest letter-run,
            lowercased: “tennis” → T, “I’ve” → “ve” → V, “24” → nothing (never
            usable). This is why the initials column can differ from the first
            character you see.
          </li>
          <li>
            To decode, read each token as that letter and concatenate. Nothing
            else is needed — no key, no password.
          </li>
          <li>
            The digest binds the cipher to this exact book; a different
            transcript changes every number.
          </li>
        </ol>
      </section>
    </div>
  );
}

function Gallery({
  puzzles,
  loading,
  open,
}: {
  puzzles: Puzzle[];
  loading: boolean;
  open: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="m-card-elevated p-5">
        <h1 className="text-lg font-semibold text-white">Puzzle books</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
          A transparent book cipher: a transcript of a real recording is the
          book, and the cipher is a list of word indices. No key — solving it is
          the point. Every puzzle ships with its book so the answer is
          verifiable, never guessable.
        </p>
      </section>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">loading…</div>
      ) : puzzles.length === 0 ? (
        <div className="m-card p-10 text-center">
          <div className="text-sm text-slate-200">No puzzles yet</div>
          <p className="mt-1 text-xs text-slate-500">
            The local studio publishes puzzle books here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {puzzles.map((puzzle) => (
            <button
              key={puzzle.slug}
              type="button"
              onClick={() => open(puzzle.slug)}
              className="m-card group p-4 text-left transition hover:brightness-110"
            >
              <div className="text-sm font-semibold text-slate-100 group-hover:text-white">
                {puzzle.data.title ?? puzzle.slug}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {puzzle.data.transcript?.words?.length ?? 0} words ·{' '}
                {puzzle.data.cipher?.tokens?.length ?? 0} tokens
              </div>
              <div className="mt-2 text-[10px] text-slate-600">
                {postedAt(puzzle.data.created_at)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [selected, setSelected] = useState<string | null>(slugFromHash);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'edu_puzzles'), orderBy('created_at', 'desc')),
      (snap) => {
        setPuzzles(
          snap.docs.map((item) => ({
            slug: item.id,
            data: item.data() as PuzzleDoc,
          })),
        );
      },
      () => setPuzzles([]),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const onHash = () => setSelected(slugFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (slug: string | null) => {
    setSelected(slug);
    if (slug) {
      window.history.replaceState(null, '', `#/p/${slug}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  return (
    <div className="min-h-full bg-[radial-gradient(ellipse_at_top,rgba(244,114,182,0.08),transparent_55%)]">
      <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-4 px-4 py-5">
        <header className="m-appbar sticky top-0 z-30 -mx-4 mb-1 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => open(null)}
            className="flex items-baseline gap-2"
          >
            <span className="text-xl font-bold tracking-tight text-white">
              Tata
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-200">
              book cipher
            </span>
          </button>
          <span className="text-[11px] text-slate-500">
            no key · verify by digest · by Emmanuel Secretaria
          </span>
        </header>

        {selected ? (
          <PuzzleView key={selected} slug={selected} onBack={() => open(null)} />
        ) : (
          <Gallery puzzles={puzzles ?? []} loading={puzzles === null} open={open} />
        )}

        <footer className="text-[10px] leading-relaxed text-slate-600">
          The transcript is the book. The indices are the ciphertext. Reading
          the first letter of each chosen word recovers the message.
          <span className="mt-1 block">
            Tata cipher — design and implementation by Emmanuel Secretaria.
          </span>
        </footer>
      </div>
    </div>
  );
}
