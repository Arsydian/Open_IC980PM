// @vitest-environment jsdom
/**
 * @file tests/backupVaultModal.test.tsx
 * @description Backup & Vault dialog error handling (`src/components/BackupVaultModal.tsx`).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupVaultModal } from '../src/components/BackupVaultModal';
import { createDefaultCodeplug } from '../src/core/ysfCodec';
import type { ElectronBridgeApi } from '../src/types/global';
import type { RollbackSnapshot } from '../src/types/radio';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { api?: ElectronBridgeApi }).api;
});

const snapshot: RollbackSnapshot = {
  id: 'snap-1',
  createdAt: '2026-10-29T00:00:00Z',
  label: 'Radio before write',
  activeChannelCount: 3,
  ysfBase64: '',
};

function installBridge(overrides: Partial<ElectronBridgeApi>) {
  (window as { api?: Partial<ElectronBridgeApi> }).api = {
    listRollbackSnapshots: async () => [snapshot],
    saveRollbackSnapshot: async () => undefined,
    deleteRollbackSnapshot: async () => undefined,
    ...overrides,
  };
}

const renderVault = () =>
  render(
    <BackupVaultModal isOpen codeplug={createDefaultCodeplug()} onClose={() => undefined} onRestoreCodeplug={() => undefined} />
  );

describe('BackupVaultModal', () => {
  it('shows an error when the vault cannot be read', async () => {
    installBridge({ listRollbackSnapshots: async () => Promise.reject(new Error('EACCES')) });
    renderVault();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the Rollback Vault: EACCES');
  });

  it('shows an error when deleting a snapshot fails', async () => {
    installBridge({ deleteRollbackSnapshot: async () => Promise.reject(new Error('disk full')) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderVault();
    await screen.findByText('Radio before write');

    fireEvent.click(screen.getByRole('button', { name: 'Delete snapshot Radio before write' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not delete the snapshot: disk full');
  });
});
