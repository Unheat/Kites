import React, { useState } from 'react';
import type { UserAccountInfo } from '../../shared/types';
import { LogOut, Sparkles, CheckCircle2 } from 'lucide-react';

interface AccountCardProps {
  userAccount?: UserAccountInfo;
  onAccountChange: (account?: UserAccountInfo) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({ userAccount, onAccountChange }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    setIsLoading(true);
    setError(null);

    chrome.runtime.sendMessage({ type: 'SIGN_IN_GOOGLE' }, (response) => {
      setIsLoading(false);
      if (chrome.runtime.lastError || !response?.success) {
        setError(response?.error || chrome.runtime.lastError?.message || 'Sign in cancelled');
      } else if (response.userAccount) {
        onAccountChange(response.userAccount);
      }
    });
  };

  const handleSignOut = () => {
    setIsLoading(true);
    setError(null);

    chrome.runtime.sendMessage({ type: 'SIGN_OUT_GOOGLE' }, (response) => {
      setIsLoading(false);
      if (response?.success) {
        onAccountChange(undefined);
      } else {
        setError(response?.error || 'Sign out failed');
      }
    });
  };

  if (userAccount?.signedIn) {
    const initials = (userAccount.name || userAccount.email || 'U')
      .slice(0, 1)
      .toUpperCase();

    return (
      <div className="p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-[var(--color-dust)]">
            <Sparkles className="w-3.5 h-3.5 text-[var(--color-editorial)]" />
            <span>Kites Cloud Pass</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" />
            Active
          </span>
        </div>

        <div className="flex items-center gap-2.5 pt-0.5">
          {userAccount.picture ? (
            <img
              src={userAccount.picture}
              alt="User"
              className="w-8 h-8 rounded-full border border-[var(--color-dust)]/50 object-cover flex-shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--color-editorial)]/15 text-[var(--color-editorial)] font-bold text-xs flex items-center justify-center border border-[var(--color-editorial)]/30 flex-shrink-0">
              {initials}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-[var(--color-ink)] truncate leading-tight">
              {userAccount.name || 'Google User'}
            </div>
            <div className="text-[11px] text-[var(--color-dust)] truncate leading-tight mt-0.5">
              {userAccount.email}
            </div>
          </div>
        </div>

        <div className="pt-1 border-t border-[var(--color-dust)]/20 flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-dust)]">
            100 free translations / 24h
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isLoading}
            className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-dust)] hover:text-[var(--color-editorial)] transition-colors py-0.5 px-1.5 rounded hover:bg-[var(--color-paper)]"
          >
            <LogOut className="w-3 h-3" />
            <span>{isLoading ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>

        {error && (
          <div className="text-[11px] text-red-500 bg-red-500/10 px-2 py-1 rounded">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-[var(--color-dust)]">
        <Sparkles className="w-3.5 h-3.5 text-[var(--color-editorial)]" />
        <span>Shared Translation Pool</span>
      </div>

      <p className="text-[11px] text-[var(--color-dust)] leading-relaxed">
        Sign in to unlock <strong className="text-[var(--color-ink)]">100 free cloud translations/day</strong> across Gemma, Mistral, and NVIDIA models.
      </p>

      <button
        type="button"
        onClick={handleSignIn}
        disabled={isLoading}
        className="w-full bg-[var(--color-paper)] text-[var(--color-ink)] border border-[var(--color-dust)] hover:border-[var(--color-editorial)] transition-all font-medium py-1.5 px-3 rounded text-xs flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] disabled:opacity-60"
      >
        {/* Google G Multi-color SVG */}
        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>{isLoading ? 'Connecting Google...' : 'Sign in with Google'}</span>
      </button>

      {error && (
        <div className="text-[11px] text-red-500 bg-red-500/10 px-2 py-1 rounded">
          {error}
        </div>
      )}
    </div>
  );
};
