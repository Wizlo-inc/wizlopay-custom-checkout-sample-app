'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  token: string;
  amount: number;
  currency: string;
  country: string;
  buyerId?: string | null;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: { account_id: string }) => void;
        onExit: (err: unknown) => void;
        onLoad?: () => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}

export function PlaidButton({ token, amount, currency, country, buyerId, onSuccess, onError }: Props) {
  const [scriptReady, setScriptReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const handlerRef = useRef<{ open: () => void; destroy: () => void } | null>(null);

  // Load Plaid Link JS SDK once
  useEffect(() => {
    if (document.querySelector('script[src*="cdn.plaid.com"]')) {
      setScriptReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => console.error('Failed to load Plaid Link SDK');
    document.head.appendChild(script);
  }, []);

  // Cleanup handler on unmount
  useEffect(() => {
    return () => {
      handlerRef.current?.destroy();
    };
  }, []);

  async function handleClick() {
    if (!scriptReady || !window.Plaid) {
      onError(new Error('Plaid SDK not loaded yet'));
      return;
    }

    setLoading(true);

    try {
      // 1. Get link token from backend
      const res = await fetch('/api/checkout/plaid-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { linkToken?: string; message?: string };
      if (!res.ok || !body.linkToken) throw new Error(body.message ?? 'Failed to get Plaid link token');

      // 2. Open Plaid Link
      const handler = window.Plaid.create({
        token: body.linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            // 3. Create transaction via gr4vy with the Plaid public token.
            // paymentServiceId is injected server-side — never exposed to the frontend.
            const txRes = await fetch('/api/checkout/transaction', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                amount,
                currency,
                country,
                paymentMethod: {
                  method: 'plaid',
                  token: publicToken,
                  accountId: metadata.account_id,
                },
                intent: 'capture',
                ...(buyerId && { buyerId }),
              }),
            });
            const txBody = await txRes.json() as { transactionId?: string; message?: string };
            if (!txRes.ok) throw new Error(txBody.message ?? 'Plaid transaction failed');
            onSuccess(txBody.transactionId!);
          } catch (err) {
            onError(err instanceof Error ? err : new Error('Plaid payment failed'));
          } finally {
            setLoading(false);
          }
        },
        onExit: (err) => {
          setLoading(false);
          if (err) console.error('Plaid Link exited with error', err);
        },
      });

      handlerRef.current = handler;
      handler.open();
    } catch (err) {
      setLoading(false);
      onError(err instanceof Error ? err : new Error('Failed to open Plaid'));
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading || !scriptReady}
      aria-label="Pay with bank account via Plaid"
      className="w-full h-12 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2.5"
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <>
          {/* Plaid wordmark */}
          <svg className="h-5 w-auto" viewBox="0 0 80 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="4" width="8" height="8" rx="1" fill="#111"/>
            <rect x="10" y="0" width="8" height="8" rx="1" fill="#111"/>
            <rect x="0" y="14" width="8" height="8" rx="1" fill="#111" opacity="0.4"/>
            <rect x="10" y="10" width="8" height="8" rx="1" fill="#111" opacity="0.7"/>
            <rect x="10" y="20" width="8" height="4" rx="1" fill="#111" opacity="0.3"/>
            <text x="24" y="17" fontFamily="system-ui, -apple-system, sans-serif" fontSize="14" fontWeight="600" fill="#111">plaid</text>
          </svg>
          <span className="text-sm font-semibold text-gray-800">Pay with bank</span>
        </>
      )}
    </button>
  );
}
