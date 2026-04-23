'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  instanceId: string;
  environment: string;
  checkoutSessionId: string;
  amount: number;
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

const STYLES = {
  color: '#111827',
  fontSize: '15px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontWeight: '400',
  lineHeight: '1.5',
  padding: '0 12px',
  '::placeholder': { color: '#9ca3af' },
  ':focus': { color: '#111827', outline: 'none' },
};

export function CardTab({ instanceId, environment, checkoutSessionId, amount, currency, country, onSuccess, onError }: Props) {
  const sfRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [formComplete, setFormComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutSessionId || !instanceId) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest/secure-fields.css`;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest/secure-fields.js`;
    script.async = true;
    script.onload = init;
    script.onerror = () => setFieldError('Failed to load secure card fields.');
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(link)) document.head.removeChild(link);
      if (document.head.contains(script)) document.head.removeChild(script);
      sfRef.current = null;
    };
  }, [instanceId, checkoutSessionId]);

  function init() {
    const SecureFields = (window as any).SecureFields;
    if (!SecureFields) return;

    const sf = new SecureFields({
      gr4vyId: instanceId,
      environment,
      sessionId: checkoutSessionId,
    });

    sfRef.current = sf;

    sf.addCardNumberField('#sf-card-number', { placeholder: '1234 5678 9012 3456', styles: STYLES });
    sf.addExpiryDateField('#sf-expiry', { placeholder: 'MM / YY', styles: STYLES });
    sf.addSecurityCodeField('#sf-cvv', { placeholder: 'CVV', styles: STYLES });

    sf.addEventListener(SecureFields.Events.READY, () => setReady(true));

    sf.addEventListener(SecureFields.Events.FORM_CHANGE, (data: any) => {
      setFormComplete(data?.complete === true);
    });

    sf.addEventListener(SecureFields.Events.CARD_VAULT_SUCCESS, async () => {
      try {
        const res = await fetch('/api/checkout/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount,
            currency,
            country,
            paymentMethod: {
              method: 'checkout-session',
              id: checkoutSessionId,
              ...(window.location.hostname !== 'localhost' && {
                redirectUrl: `${window.location.origin}/checkout/callback`,
              }),
            },
          }),
        });
        const body = await res.json() as { transactionId?: string; message?: string };
        if (!res.ok) throw new Error(body.message ?? 'Transaction failed');
        onSuccess(body.transactionId!);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Payment failed';
        setFieldError(msg);
        onError(err instanceof Error ? err : new Error(msg));
      } finally {
        setSubmitting(false);
      }
    });

    sf.addEventListener(SecureFields.Events.CARD_VAULT_FAILURE, (data: any) => {
      const msg = data?.message ?? 'Card could not be processed. Please check your details.';
      setFieldError(msg);
      onError(new Error(msg));
      setSubmitting(false);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sfRef.current || submitting || !formComplete) return;
    setFieldError(null);
    setSubmitting(true);
    sfRef.current.submit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Card number</label>
        <div className="secure-field-wrap">
          <div id="sf-card-number" className="secure-field-host" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Expiry</label>
          <div className="secure-field-wrap">
            <div id="sf-expiry" className="secure-field-host" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">CVV</label>
          <div className="secure-field-wrap">
            <div id="sf-cvv" className="secure-field-host" />
          </div>
        </div>
      </div>

      {fieldError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-red-600">{fieldError}</p>
        </div>
      )}

      {!ready && !fieldError && (
        <div className="flex items-center justify-center gap-2 py-1">
          <svg className="animate-spin h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="text-xs text-gray-400">Loading secure fields…</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!ready || !formComplete || submitting}
        className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white py-3.5 rounded-xl text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Processing…
          </span>
        ) : (
          `Pay ${fmt(amount, currency)}`
        )}
      </button>
    </form>
  );
}

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
