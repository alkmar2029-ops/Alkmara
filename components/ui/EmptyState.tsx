import { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <div className="flex justify-center mb-4 text-gray-300">
        {icon || <Inbox className="w-12 h-12" />}
      </div>
      <h3 className="text-gray-500 font-medium mb-1">{title}</h3>
      {description && <p className="text-gray-400 text-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
