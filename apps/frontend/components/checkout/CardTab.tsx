'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  instanceId: string;
  environment: string;
  checkoutSessionId: string;
  amount: number;
  currency: string;
  country: string;
  buyerId?: string | null;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

// Styles applied INSIDE the gr4vy Secure Fields iframes
const SF_STYLES = {
  color: '#111827',
  fontSize: '15px',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontWeight: '400',
  padding: '0 14px',
  lineHeight: '1',
  '::placeholder': { color: '#9ca3af' },
};


export function CardTab({
  instanceId,
  environment,
  checkoutSessionId,
  amount,
  currency,
  country,
  buyerId,
  onSuccess,
  onError,
}: Props) {
  const sfRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [formComplete, setFormComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutSessionId || !instanceId) return;

    // We intentionally do NOT load gr4vy's secure-fields.css:
    // it injects validation-state red colouring that overrides our iframe styles.
    // Our globals.css handles all host-level layout for .sf-host and .sf-card-*.

    const script = document.createElement('script');
    script.src = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest/secure-fields.js`;
    script.async = true;
    script.onload = init;
    script.onerror = () => setFieldError('Failed to load secure card fields.');
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
      sfRef.current = null;
    };
  }, [instanceId, checkoutSessionId]);

  function init() {
    const SecureFields = (window as any).SecureFields;
    if (!SecureFields) return;

    const sf = new SecureFields({ gr4vyId: instanceId, environment, sessionId: checkoutSessionId });
    sfRef.current = sf;

    sf.addCardNumberField('#sf-number', {
      placeholder: '1234 5678 9012 3456',
      styles: SF_STYLES,
      autoFocus: true,
      maskInput: { character: '•', maskOnInput: false, showLastFour: true },
      showSchemeIcons: { scheme: true, additionalSchemes: true, placeholders: true },
    });

    sf.addExpiryDateField('#sf-expiry', {
      placeholder: 'MM / YY',
      styles: SF_STYLES,
    });

    sf.addSecurityCodeField('#sf-cvv', {
      placeholder: 'CVV',
      styles: SF_STYLES,
    });

    sf.setAutoAdvance({
      enabled: true,
      fieldOrder: ['number', 'expiryDate', 'securityCode'],
    });

    sf.addEventListener(SecureFields.Events.READY, () => setReady(true));

    sf.addEventListener(SecureFields.Events.FORM_CHANGE, (d: any) => {
      setFormComplete(d?.complete === true);
    });

    sf.addEventListener(SecureFields.Events.CARD_VAULT_SUCCESS, async () => {
      try {
        const res = await fetch('/api/checkout/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount, currency, country,
            ...(buyerId && { buyerId }),
            paymentMethod: {
              method: 'checkout-session',
              id: checkoutSessionId,
              redirectUrl: `${window.location.origin}/checkout/callback`,
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

    sf.addEventListener(SecureFields.Events.CARD_VAULT_FAILURE, (d: any) => {
      const msg = d?.message ?? 'Card could not be processed. Please check your details.';
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

      {/* Grouped Stripe-style card fields */}
      <div className="sf-card-group">

        {/* Row 1: Card number — gr4vy injects scheme icons below the iframe */}
        <div className="sf-card-row">
          <div className="sf-card-cell sf-card-cell--number">
            <div id="sf-number" className="sf-host" />
          </div>
        </div>

        {/* Row 2: Expiry + CVV */}
        <div className="sf-card-row">
          <div className="sf-card-cell">
            <div id="sf-expiry" className="sf-host" />
          </div>
          <div className="sf-card-cell">
            <div id="sf-cvv" className="sf-host" />
          </div>
        </div>
      </div>

      {/* Loading */}
      {!ready && !fieldError && (
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-3 w-3 text-gray-300" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="text-xs text-gray-400">Loading secure fields…</p>
        </div>
      )}

      {/* Error */}
      {fieldError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2.5">
          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-red-600 leading-relaxed">{fieldError}</p>
        </div>
      )}

      {/* Pay button */}
      <button
        type="submit"
        disabled={!ready || !formComplete || submitting}
        className="w-full bg-[#6938EF] hover:bg-[#5526D9] active:bg-[#4415C0] text-white py-3.5 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Processing…
          </span>
        ) : `Pay ${fmt(amount, currency)}`}
      </button>
    </form>
  );
}

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
