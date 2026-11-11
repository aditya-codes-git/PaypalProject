import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Confirmation = {
  title: string;
  message: string;
  action: string;
};

type Confirm = (confirmation: Confirmation) => Promise<boolean>;
const ConfirmationContext = createContext<Confirm | null>(null);

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('Missing confirmation provider.');
  return confirm;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolve = useRef<((accepted: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const confirm: Confirm = options => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>(accept => {
      resolve.current = accept;
      setRequest(options);
    });
  };

  useLayoutEffect(() => {
    if (request) dialog.current?.showModal();
  }, [request]);

  function finish(accepted: boolean) {
    dialog.current?.close();
    const complete = resolve.current;
    resolve.current = null;
    setRequest(null);
    complete?.(accepted);
  }

  return <ConfirmationContext.Provider value={confirm}>
    {children}
    {request && <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      onCancel={event => { event.preventDefault(); finish(false); }}
    >
      <h2 id="confirmation-title">{request.title}</h2>
      <p id="confirmation-message">{request.message}</p>
      <div className="confirmation-actions">
        <button className="button subtle" autoFocus onClick={() => finish(false)}>Cancel</button>
        <button className="button primary" onClick={() => finish(true)}>{request.action}</button>
      </div>
    </dialog>}
  </ConfirmationContext.Provider>;
}
