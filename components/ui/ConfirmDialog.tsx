'use client';
import Modal from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export default function ConfirmDialog({
  isOpen, onConfirm, onCancel, title, message,
  confirmText = 'تأكيد', cancelText = 'إلغاء', variant = 'danger'
}: ConfirmDialogProps) {
  const variantClasses = {
    danger: 'btn-danger',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg',
    info: 'btn-primary',
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} maxWidth="max-w-md">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="btn-secondary">{cancelText}</button>
        <button onClick={onConfirm} className={variantClasses[variant]}>{confirmText}</button>
      </div>
    </Modal>
  );
}
