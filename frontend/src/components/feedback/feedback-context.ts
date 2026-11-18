import { createContext, useContext } from 'react';

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Name the action ("Delete role", "Send 12 emails"); never just "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export type ToastTone = 'success' | 'warning' | 'error';

export interface ToastApi {
  /** Auto-hides after a few seconds. */
  success: (message: string) => void;
  /** Partly done ("Saved, but the list couldn't refresh"). Stays until dismissed. */
  warning: (message: string) => void;
  /** Stays until dismissed, so it isn't missed. */
  error: (message: string) => void;
}

export interface FeedbackApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: ToastApi;
}

export const FeedbackContext = createContext<FeedbackApi | null>(null);

function useFeedback(): FeedbackApi {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('FeedbackProvider is missing');
  return value;
}

/** `if (!(await confirm({ title, confirmLabel }))) return;` */
export function useConfirm() {
  return useFeedback().confirm;
}

export function useToast() {
  return useFeedback().toast;
}
