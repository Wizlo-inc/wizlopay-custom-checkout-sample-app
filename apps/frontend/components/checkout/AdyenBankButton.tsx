'use client';

import { useState } from 'react';

interface PaymentOption {
  method: string;
  label?: string | null;
  iconUrl?: string | null;
  mode: string;
}

interface Props {
  methods: PaymentOption[];
  token: string;
  amount: number;
  currency: string;
  country: string;
  checkoutSessionId: string;
  buyerId?: string | null;
}

export function AdyenBankButton({ methods, token, amount, currency, country, checkoutSessionId, buyerId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use first available method (e.g. pay-by-bank)
  const method = methods[0];
  if (!method) return null;

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/checkout/bnpl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          method: method.method,
          amount,
          currency,
          country,
          checkoutSessionId,
          redirectUrl: `${window.location.origin}/checkout/callback`,
          ...(buyerId && { buyerId }),
          cartItems: [],
        }),
      });

      const body = await res.json() as { approvalUrl?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not initiate bank payment.');
      if (!body.approvalUrl) throw new Error('No approval URL returned from bank redirect.');

      window.location.href = body.approvalUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full h-12 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3 px-4"
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        ) : (
          <>
            {/* Bank icon */}
            <svg className="w-5 h-5 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l9-9 9 9M4 10v10a1 1 0 001 1h5v-6h4v6h5a1 1 0 001-1V10" />
            </svg>
            <span className="text-sm font-semibold text-gray-800">
              {method.label ?? 'Pay by Bank'}
            </span>
            {/* Adyen badge */}
            <span className="ml-auto text-[10px] font-medium text-gray-400 tracking-wide">via Adyen</span>
          </>
        )}
      </button>

      {error && (
        <p className="text-xs text-red-500 text-center">{error}</p>
      )}
    </div>
  );
}
