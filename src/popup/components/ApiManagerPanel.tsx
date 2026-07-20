import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { PopupState } from '../../shared/types';
import AddApiForm from './AddApiForm';

interface ApiManagerPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
  onClose: () => void;
}

export default function ApiManagerPanel({ state, updateState, onClose }: ApiManagerPanelProps) {
  const [isAdding, setIsAdding] = useState(false);

  const handleDeleteApi = (id: string) => {
    updateState({
      customApis: state.customApis.filter(api => api.id !== id),
      fallbackChain: state.fallbackChain.filter(chainId => chainId !== id)
    });
  };

  return (
    <div className="p-3 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[var(--color-editorial)]">Manage Custom APIs</h3>
        <div className="flex gap-2">
          {!isAdding && (
            <button 
              onClick={() => setIsAdding(true)}
              className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
              title="Add New API"
            >
              <Plus size={16} />
            </button>
          )}
          <button 
            onClick={onClose}
            className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {state.customApis.map((api) => (
          <div key={api.id} className="flex items-center justify-between p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-xs uppercase text-[var(--color-dust)]">{api.provider}</span>
              <span className="font-mono text-[var(--color-ink)] truncate max-w-[200px]" title={api.modelName}>
                {api.modelName}
              </span>
            </div>
            <button 
              onClick={() => handleDeleteApi(api.id)}
              className="text-[var(--color-dust)] hover:text-red-500 transition-colors cursor-pointer p-1"
              title="Delete API"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        
        {state.customApis.length === 0 && !isAdding && (
          <div className="text-xs text-[var(--color-dust)] italic p-3 text-center border border-dashed border-[var(--color-dust)] rounded">
            No custom APIs configured.
          </div>
        )}

        {isAdding && (
          <AddApiForm 
            onSave={(api) => {
              updateState({ customApis: [...state.customApis, api] });
              setIsAdding(false);
            }} 
            onCancel={() => setIsAdding(false)} 
          />
        )}
      </div>
    </div>
  );
}
