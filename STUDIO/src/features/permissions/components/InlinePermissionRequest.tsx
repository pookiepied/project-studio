import React from 'react';
import { Check, X, Shield } from '@phosphor-icons/react';

interface InlinePermissionRequestProps {
  operation: {
    type: string;
    path: string;
    content?: string;
  };
  onApprove: () => void;
  onDeny: () => void;
}

export const InlinePermissionRequest: React.FC<InlinePermissionRequestProps> = ({
  operation,
  onApprove,
  onDeny
}) => {
  const operationDesc = operation.type === 'mkdir' ? 'directory' : 'file';
  const actionDesc = operation.type === 'mkdir' ? 'Create' : 'Create';

  return (
    <div className="relative bg-surface-raised border border-surface-border rounded-lg p-3 my-2 ml-12">
      {/* AI Avatar indicator */}
      <div className="absolute -left-10 top-3 w-8 h-8 bg-surface-raised rounded-full flex items-center justify-center">
        <Shield size={16} className="text-white" />
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">
              Permission Request
            </span>
          </div>
          
          <p className="text-sm text-secondary mb-2">
            {actionDesc} {operationDesc}: <code className="bg-surface-raised px-1 py-0.5 rounded text-xs font-mono">{operation.path}</code>
          </p>
          
          {operation.content && (
            <div className="text-xs text-secondary mb-2">
              <strong>Content:</strong> 
              <code className="bg-surface-raised px-1 py-0.5 rounded ml-1 font-mono">
                {operation.content.substring(0, 80)}{operation.content.length > 80 ? '...' : ''}
              </code>
            </div>
          )}
        </div>
        
        <div className="flex gap-2 ml-4">
          <button
            onClick={onApprove}
            className="flex items-center gap-1 px-3 py-1.5 bg-surface-raised hover:bg-surface-raised text-white text-xs rounded transition-colors"
          >
            <Check size={12} />
            Allow
          </button>
          
          <button
            onClick={onDeny}
            className="flex items-center gap-1 px-3 py-1.5 bg-surface-raised hover:bg-surface-raised text-white text-xs rounded transition-colors"
          >
            <X size={12} />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
};