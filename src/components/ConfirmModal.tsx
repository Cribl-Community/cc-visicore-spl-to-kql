import { Modal, Text } from '@capra/core';

/** A volatile operation waiting for the user's go-ahead. */
export interface Confirmation {
  title: string;
  /** Names exactly what is affected and whether it can be undone. */
  body: string;
  confirmText: string;
  run: () => void;
}

/** Confirmation prompt shown before deleting or replacing stored data. */
export function ConfirmModal({ pending, onClose }: { pending: Confirmation | null; onClose: () => void }) {
  return (
    <Modal
      isOpen={!!pending}
      onIsOpenChange={(open) => !open && onClose()}
      title={pending?.title ?? ''}
      confirmButtonText={pending?.confirmText}
      onConfirm={() => {
        pending?.run();
        onClose();
      }}
      onClose={onClose}
    >
      <Text variant="body-sm-normal">{pending?.body}</Text>
    </Modal>
  );
}
