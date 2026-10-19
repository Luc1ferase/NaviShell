import type { SftpClient, TransferHandle, TransferProgress } from '@navishell/plugin-api';

import { Channel, call } from '../ipc/client';
import { uuid } from '../util/fn';

function startTransfer(
  run: (transferId: string, channel: Channel<TransferProgress>) => Promise<void>,
  onProgress?: (progress: TransferProgress) => void,
): TransferHandle {
  const transferId = uuid();
  const channel = new Channel<TransferProgress>((progress) => onProgress?.(progress));
  const done = run(transferId, channel);
  return {
    transferId,
    done,
    cancel: () => call('sftp_cancel', { transferId }),
  };
}

/** SFTP client bound to one connection; the Rust side opens the session lazily. */
export function createSftpClient(connectionId: string): SftpClient {
  return {
    connectionId,
    home: () => call('sftp_home', { connectionId }),
    list: (path) => call('sftp_list', { connectionId, path }),
    stat: (path) => call('sftp_stat', { connectionId, path }),
    mkdir: (path) => call('sftp_mkdir', { connectionId, path }),
    rename: (from, to) => call('sftp_rename', { connectionId, from, to }),
    remove: (path, options) =>
      call('sftp_remove', { connectionId, path, recursive: options?.recursive }),
    readText: (path, options) =>
      call('sftp_read_text', { connectionId, path, maxBytes: options?.maxBytes }),
    writeText: (path, content) => call('sftp_write_text', { connectionId, path, content }),
    download: (remotePath, localPath, onProgress) =>
      startTransfer(
        (transferId, channel) =>
          call(
            'sftp_download',
            { connectionId, remotePath, localPath, transferId },
            { onProgress: channel },
          ),
        onProgress,
      ),
    upload: (localPath, remotePath, onProgress) =>
      startTransfer(
        (transferId, channel) =>
          call(
            'sftp_upload',
            { connectionId, localPath, remotePath, transferId },
            { onProgress: channel },
          ),
        onProgress,
      ),
  };
}
