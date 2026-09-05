/**
 * Client-Side OAuth Strategy Interfaces
 */

import type { UserAccountInfo } from '../../shared/types';

export interface IOAuthStrategy {
  readonly provider: string;

  /**
   * Triggers the interactive sign-in flow and returns user profile.
   */
  signIn(): Promise<UserAccountInfo>;

  /**
   * Invalidates local/cached tokens and signs out.
   */
  signOut(): Promise<void>;
}
