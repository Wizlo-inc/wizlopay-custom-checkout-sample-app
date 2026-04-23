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
  amount: number;
  currency: string;
  country: string;
  token: string;
  checkoutSessionId: string;
  cartItems?: { name: string; quantity: number; unitAmount: number }[];
}

const BNPL_CONTENT: Record<string, {
  color: string;
  badge: string;
  tagline: string;
  description: string;
  cta: string;
  disclaimer: string;
  highlight: string;
}> = {
  klarna: {
    color: 'from-pink-50 to-rose-50',
    badge: 'Interest-free',
    tagline: '4 payments of',
    description: 'Split into 4 equal payments due every 2 weeks. No interest, no fees when you pay on time. Klarna performs a soft credit check that won\'t affect your score.',
    cta: 'Continue with Klarna',
    disclaimer: 'Subject to eligibility. See Klarna\'s terms.',
    highlight: 'bg-pink-50 text-pink-700 border-pink-100',
  },
  affirm: {
    color: 'from-blue-50 to-indigo-50',
    badge: 'Monthly payments',
    tagline: 'From as low as',
    description: 'Pay over 3, 6, or 12 months. Rates from 0–36% APR based on creditworthiness. Checking your rate won\'t affect your credit score. US orders only.',
    cta: 'Continue with Affirm',
    disclaimer: 'Subject to credit approval. US orders only.',
    highlight: 'bg-blue-50 text-blue-700 border-blue-100',
  },
};

export function BNPLTab({ methods, amount, currency, country, token, checkoutSessionId, cartItems }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(method: string) {
    setLoading(method);
    setError(null);

    try {
      const res = await fetch('/api/checkout/bnpl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          method,
          amount,
          currency,
          country,
          checkoutSessionId,
          redirectUrl: `${window.location.origin}/checkout/callback`,
          cartItems: cartItems ?? [],
        }),
      });

      if (!res.ok) {
        const { message } = (await res.json()) as { message?: string };
        throw new Error(message ?? 'Could not initiate payment. Please try again.');
      }

      const { approvalUrl } = (await res.json()) as { approvalUrl: string };
      window.open(approvalUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setLoading(null);
    }
  }

  if (methods.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm text-gray-500">No financing options available for this order.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-gray-400 mb-3">
        Finance your purchase and pay over time. Select an option to check eligibility.
      </p>

      {methods.map((m) => {
        const content = BNPL_CONTENT[m.method];
        const isOpen = expanded === m.method;
        const isLoading = loading === m.method;

        if (!content) return null;

        return (
          <div
            key={m.method}
            className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
              isOpen ? 'border-gray-300 shadow-sm' : 'border-gray-100 hover:border-gray-200'
            }`}
          >
            <button
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                isOpen ? `bg-gradient-to-r ${content.color}` : 'bg-white hover:bg-gray-50'
              }`}
              onClick={() => setExpanded(isOpen ? null : m.method)}
              aria-expanded={isOpen}
            >
              {m.iconUrl ? (
                <img src={m.iconUrl} alt={m.label ?? m.method} className="h-6 w-auto flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{(m.label ?? m.method).slice(0, 1).toUpperCase()}</span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{m.label ?? m.method}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${content.highlight}`}>
                    {content.badge}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {m.method === 'klarna'
                    ? `${content.tagline} ${fmtInstallment(amount, currency, 4)}`
                    : `${content.tagline} ${fmtInstallment(amount, currency, 6)}/mo`}
                </p>
              </div>

              <ChevronIcon open={isOpen} />
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-100">
                <p className="text-sm text-gray-600 leading-relaxed">{content.description}</p>

                {error && loading !== m.method && (
                  <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}

                <button
                  onClick={() => handleSelect(m.method)}
                  disabled={isLoading}
                  className="w-full mt-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Opening {m.label}…
                    </span>
                  ) : (
                    content.cta
                  )}
                </button>

                <p className="text-xs text-gray-400 text-center mt-2">{content.disclaimer}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function fmtInstallment(totalCents: number, currency: string, parts: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(totalCents / 100 / parts);
}
