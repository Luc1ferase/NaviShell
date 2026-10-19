import type { JSX } from 'react';
import { Ban, Check, Download, TriangleAlert, Upload, X } from 'lucide-react';
import { formatSize, percent } from '../format';
import type { SftpController, TransferItem } from '../store';
import type { Translate } from '../types';

function StatusIcon({ status }: { status: TransferItem['status'] }): JSX.Element | null {
  switch (status) {
    case 'done':
      return <Check size={13} className="ns-sftp-transfer-ok" />;
    case 'error':
      return <TriangleAlert size={13} className="ns-sftp-transfer-error" />;
    case 'cancelled':
      return <Ban size={13} className="ns-sftp-transfer-cancelled" />;
    default:
      return null;
  }
}

interface TransferListProps {
  transfers: TransferItem[];
  controller: SftpController;
  t: Translate;
}

export function TransferList({ transfers, controller, t }: TransferListProps): JSX.Element | null {
  if (transfers.length === 0) return null;
  const hasFinished = transfers.some((item) => item.status !== 'running');
  return (
    <div className="ns-sftp-transfers">
      <div className="ns-sftp-transfers-head">
        <span>
          {t('transfers.title')} ({transfers.length})
        </span>
        {hasFinished ? (
          <button
            type="button"
            className="ns-sftp-link-button"
            onClick={() => controller.clearFinished()}
          >
            {t('transfers.clear')}
          </button>
        ) : null}
      </div>
      {transfers.map((item) => {
        const ratio = percent(item.transferred, item.total);
        const label =
          item.status === 'running'
            ? `${formatSize(item.transferred)}${item.total === null ? '' : ` / ${formatSize(item.total)}`}`
            : t(`transfers.${item.status === 'done' ? 'done' : item.status}`);
        return (
          <div className="ns-sftp-transfer" key={item.id}>
            <span className="ns-sftp-transfer-dir" title={t(`transfers.${item.direction}`)}>
              {item.direction === 'upload' ? <Upload size={13} /> : <Download size={13} />}
            </span>
            <div className="ns-sftp-transfer-body">
              <div className="ns-sftp-transfer-top">
                <span className="ns-sftp-transfer-name" title={item.message ?? item.name}>
                  {item.name}
                </span>
                <span className="ns-sftp-transfer-meta">
                  <StatusIcon status={item.status} />
                  {label}
                </span>
              </div>
              <div
                className="ns-sftp-progress"
                role="progressbar"
                aria-valuenow={ratio}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`ns-sftp-progress-bar ns-sftp-progress-${item.status}`}
                  style={{ width: `${item.status === 'running' ? ratio : 100}%` }}
                />
              </div>
            </div>
            {item.status === 'running' ? (
              <button
                type="button"
                className="ns-sftp-icon-button ns-sftp-icon-button-small"
                title={t('transfers.cancel')}
                aria-label={t('transfers.cancel')}
                onClick={() => void controller.cancelTransfer(item.id)}
              >
                <X size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="ns-sftp-icon-button ns-sftp-icon-button-small"
                title={t('transfers.clear')}
                aria-label={t('transfers.clear')}
                onClick={() => controller.removeTransfer(item.id)}
              >
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
