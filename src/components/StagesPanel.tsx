import { EmptyState, Tag, Text } from '@capra/core';
import type { Note, StageResult } from '../translator';

export function StagesPanel({ stages, notes }: { stages: StageResult[]; notes: Note[] }) {
  if (!stages.length) return <EmptyState title="No stages yet" description="Enter an SPL query to see the stage-by-stage mapping." size="md" />;
  const worst = (i: number): Note['level'] | null => {
    const ns = notes.filter((n) => n.stage === i);
    if (ns.some((n) => n.level === 'error')) return 'error';
    if (ns.some((n) => n.level === 'warning')) return 'warning';
    if (ns.length) return 'info';
    return null;
  };
  return (
    <div className="stages">
      {stages.map((s) => {
        const level = s.unsupported ? 'error' : worst(s.index);
        return (
          <div key={s.index} className="stage-row">
            <div className="stage-head">
              <Text variant="body-xs-semibold" color="subtle">
                {s.index}
              </Text>
              <Tag size="sm" color={s.unsupported ? 'danger' : level === 'warning' ? 'warning' : level === 'error' ? 'danger' : 'default'}>
                {s.command}
              </Tag>
            </div>
            <pre className="code code-sm">{s.spl}</pre>
            <pre className={`code code-sm ${s.unsupported ? 'code-bad' : ''}`}>{s.kql.length ? s.kql.map((k) => (k.startsWith('//') ? k : `| ${k}`)).join('\n') : '(nothing emitted)'}</pre>
          </div>
        );
      })}
    </div>
  );
}
