'use client';

import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

interface Props {
  amount: number;
  currency: string;
  email?: string | null;
}

export function StripeLinkButton({ amount, currency, email }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);

  /**
   * State machine:
   * 'init'       – Stripe JS loading / ECE not yet mounted
   * 'ready'      – ECE mounted, Link available → show native button
   * 'unavailable'– ECE mounted, Link not available → show sign-up CTA
   * 'processing' – user confirmed, awaiting backend + Stripe confirm
   * 'success'    – payment complete (brief state before redirect)
   * 'error'      – confirm failed
   */
  type State = 'init' | 'ready' | 'unavailable' | 'processing' | 'success' | 'error';
  const [state, setState] = useState<State>('init');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey || !containerRef.current) return;

    let destroyed = false;

    (async () => {
      try {
        const stripe = await loadStripe(publishableKey);
        if (!stripe || destroyed) return;
        stripeRef.current = stripe;

        const elements = (stripe as any).elements({
          mode: 'payment',
          amount,
          currency: currency.toLowerCase(),
        });
        elementsRef.current = elements;

        const expressCheckout = elements.create('expressCheckout', {
          paymentMethods: {
            applePay: 'never',
            googlePay: 'never',
            paypal: 'never',
            klarna: 'never',
            amazonPay: 'never',
            link: 'auto',
          },
          layout: { maxColumns: 1, maxRows: 1 },
        });

        expressCheckout.on('ready', ({ availablePaymentMethods }: any) => {
          if (destroyed) return;
          const hasLink = !!(availablePaymentMethods as any)?.link;
          setState(hasLink ? 'ready' : 'unavailable');
        });

        expressCheckout.on('confirm', async () => {
          if (destroyed) return;
          setError(null);
          setState('processing');
          try {
            const res = await fetch('/api/checkout/stripe-intent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount,
                currency,
                ...(email && { customerEmail: email }),
              }),
            });
            const body = await res.json() as { clientSecret?: string; message?: string };
            if (!res.ok || !body.clientSecret) {
              throw new Error(body.message ?? 'Failed to create payment');
            }

            const { error: confirmError, paymentIntent } = await (stripe as any).confirmPayment({
              elements,
              clientSecret: body.clientSecret,
              redirect: 'if_required',
              confirmParams: {
                return_url: `${window.location.origin}/checkout/callback?provider=stripe`,
                ...(email && { payment_method_data: { billing_details: { email } } }),
              },
            });

            if (confirmError) {
              setError(confirmError.message ?? 'Payment failed');
              setState('error');
            } else if (
              paymentIntent?.status === 'succeeded' ||
              paymentIntent?.status === 'processing'
            ) {
              setState('success');

              // Record in our system (gr4vy has no external transaction API —
              // this saves alongside gr4vy transactions in our orders table)
              await fetch('/api/checkout/record-external', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  externalTransactionId: paymentIntent.id,
                  externalPsp: 'stripe',
                  amount,
                  currency,
                  paymentMethod: 'stripe-link',
                  status: 'capture_succeeded',
                }),
              });

              window.location.href = `/checkout/callback?transaction_id=${paymentIntent.id}&transaction_status=capture_succeeded`;
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Payment failed');
            setState('error');
          }
        });

        expressCheckout.mount(containerRef.current!);
      } catch (err) {
        console.error('Stripe Link init error:', err);
        setState('unavailable');
      }
    })();

    return () => {
      destroyed = true;
      elementsRef.current = null;
      stripeRef.current = null;
    };
  }, [amount, currency, email]);

  return (
    <div className="space-y-1.5">
      {/* Stripe ECE native button — shown only when Link is available */}
      <div
        ref={containerRef}
        style={{ display: state === 'ready' ? 'block' : 'none' }}
      />

      {/* Skeleton while Stripe JS is initialising */}
      {state === 'init' && (
        <div className="w-full h-11 rounded-xl bg-gray-100 animate-pulse" />
      )}

      {/* Processing overlay — Stripe Link is in its popup, waiting for result */}
      {state === 'processing' && (
        <div className="w-full h-11 rounded-xl bg-[#00D66B]/10 border border-[#00D66B]/30 flex items-center justify-center gap-2 text-sm font-medium text-[#009950]">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Processing with Link…
        </div>
      )}

      {/* Success state — brief before redirect */}
      {state === 'success' && (
        <div className="w-full h-11 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center gap-2 text-sm font-medium text-green-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Payment successful
        </div>
      )}

      {/* Link not available — offer sign-up */}
      {state === 'unavailable' && (
        <a
          href="https://link.com"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2.5 h-11 rounded-xl px-4 text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors no-underline"
        >
          {/* Link bolt icon */}
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-[#00D66B] flex-shrink-0">
            <path d="M10.5 2L4 13h6.5L8 22l12-13h-7L16.5 2H10.5z" fill="currentColor"/>
          </svg>
          <span className="flex-1">
            Pay faster with <span className="font-semibold text-[#00C060]">Link</span>
          </span>
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* Error message */}
      {state === 'error' && error && (
        <p className="text-xs text-red-500 text-center flex items-center justify-center gap-1">
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
