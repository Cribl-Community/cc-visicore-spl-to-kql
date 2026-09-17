import { useState } from 'react';
import { Button, EmptyState, Tag, Text } from '@capra/core';
import type { HistoryEntry } from '../api';
import { ConfirmModal, type Confirmation } from './ConfirmModal';

const when = (ts: number) => new Date(ts).toLocaleString();

export function HistoryPanel({ entries, onLoad, onClear, available }: { entries: HistoryEntry[]; onLoad: (e: HistoryEntry) => void; onClear: () => void; available: boolean }) {
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  if (!available) return <EmptyState title="History needs Cribl" description="Conversions are stored per user in the app KV store when the app runs inside Cribl." size="md" />;
  if (!entries.length) return <EmptyState title="No history yet" description="Queries you copy, check, run or save are kept here (last 50, per user)." size="md" />;
  return (
    <div className="history">
      <ConfirmModal pending={confirm} onClose={() => setConfirm(null)} />
      <div className="history-toolbar">
        <Text variant="body-sm-normal" color="subtle">
          {`${entries.length} saved conversion${entries.length === 1 ? '' : 's'}`}
        </Text>
        <Button size="sm" variant="tertiary" appearance="danger" onClick={() => setConfirm({ title: 'Clear your conversion history?', body: `This deletes your ${entries.length} saved conversion${entries.length === 1 ? '' : 's'} from the app KV store. Other users are not affected. This cannot be undone.`, confirmText: 'Clear history', run: onClear })}>
          Clear history
        </Button>
      </div>
      <ul className="history-list">
        {entries.map((e) => (
          <li key={e.id} className="history-item">
            <div className="history-head">
              <Text variant="body-xs-semibold" color="subtle">
                {when(e.ts)}
              </Text>
              {e.errors > 0 && (
                <Tag size="sm" color="danger">
                  {`${e.errors} unsupported`}
                </Tag>
              )}
              {e.warnings > 0 && (
                <Tag size="sm" color="warning">
                  {`${e.warnings} approximations`}
                </Tag>
              )}
              <Button size="sm" variant="secondary" onClick={() => onLoad(e)}>
                Load
              </Button>
            </div>
            <pre className="code code-sm">{e.spl}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
