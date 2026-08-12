import { Alert } from "@/components/ui/alert";
import { EMPTY_FORM_STATE, type FormState } from "@/components/ui/form-state";

export { EMPTY_FORM_STATE };
export type { FormState };

export interface FormMessageProps {
  state?: FormState;
  className?: string;
}

export function FormMessage({ state, className }: FormMessageProps) {
  if (!state) return null;
  if (!state.ok && state.error) {
    return (
      <Alert tone="danger" className={className}>
        {state.error}
      </Alert>
    );
  }
  if (state.ok && state.message) {
    return (
      <Alert tone="success" className={className}>
        {state.message}
      </Alert>
    );
  }
  return null;
}
