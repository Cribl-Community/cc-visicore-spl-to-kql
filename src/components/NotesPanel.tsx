import { EmptyState, Tag, Text } from '@capra/core';
import type { Note } from '../translator';

const LEVEL_TAG: Record<Note['level'], { color: 'danger' | 'warning' | 'info'; label: string }> = {
  error: { color: 'danger', label: 'needs attention' },
  warning: { color: 'warning', label: 'approximation' },
  info: { color: 'info', label: 'note' },
};

const ORDER: Note['level'][] = ['error', 'warning', 'info'];

export function NotesPanel({ notes }: { notes: Note[] }) {
  if (!notes.length) {
    return <EmptyState title="Nothing to flag" description="Every stage translated without approximations." size="md" illustration="EmptyFolder" />;
  }
  const sorted = [...notes].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level) || a.stage - b.stage);
  return (
    <ul className="notes">
      {sorted.map((n, i) => (
        <li key={i} className={`note note-${n.level}`}>
          <div className="note-meta">
            <Tag color={LEVEL_TAG[n.level].color} size="sm">
              {LEVEL_TAG[n.level].label}
            </Tag>
            <Text variant="body-xs-semibold" color="subtle">
              {n.stage > 0 ? `stage ${n.stage}` : 'query'} · {n.command}
            </Text>
          </div>
          <Text variant="body-sm-normal">{n.message}</Text>
        </li>
      ))}
    </ul>
  );
}
