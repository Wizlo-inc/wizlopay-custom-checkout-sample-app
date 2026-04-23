'use client';

import { useEffect, useState } from 'react';
import { CardTab } from './CardTab';
import { ApplePayButton } from './ApplePayButton';
import { GooglePayButton } from './GooglePayButton';
import { BNPLTab } from './BNPLTab';

type Tab = 'pay-now' | 'pay-later';

interface PaymentOption {
  method: string;
  label?: string | null;
  iconUrl?: string | null;
  mode: string;
}

interface CheckoutData {
  token: string;
  checkoutSessionId: string;
  payNow: PaymentOption[];
  payLater: PaymentOption[];
}

interface Props {
  amount: number;
  currency: string;
  country: string;
}

export function CheckoutShell({ amount, currency, country }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('pay-now');
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const instanceId = process.env.NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID ?? '';

  useEffect(() => {
    Promise.all([
      fetch('/api/checkout/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(`Token: ${body.message ?? r.status}`);
        return body;
      }),
      fetch('/api/checkout/payment-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, country }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(`Payment options: ${body.message ?? r.status}`);
        return body;
      }),
    ])
      .then(([tokenData, optionsData]) => {
        setCheckout({
          token: tokenData.token,
          checkoutSessionId: tokenData.checkoutSessionId,
          payNow: optionsData.payNow ?? [],
          payLater: optionsData.payLater ?? [],
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [amount, currency, country]);

  function onSuccess(transactionId: string) {
    window.location.href = `/checkout/callback?transaction_id=${transactionId}&transaction_status=capture_succeeded`;
  }

  function onError(err: Error) {
    setError(err.message);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="space-y-3 animate-pulse">
          <div className="h-11 bg-gray-100 rounded-xl" />
          <div className="h-px bg-gray-100 my-4" />
          <div className="h-11 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-11 bg-gray-100 rounded-xl" />
            <div className="h-11 bg-gray-100 rounded-xl" />
          </div>
          <div className="h-12 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-6 text-center">
        <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-800 mb-1">Something went wrong</p>
        <p className="text-xs text-gray-500 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs text-violet-600 font-medium hover:text-violet-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!checkout) return null;

  const hasPayLater = checkout.payLater.length > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Tab switcher */}
      {hasPayLater && (
        <div className="flex gap-1 p-1.5 bg-gray-50 border-b border-gray-100">
          <TabButton active={activeTab === 'pay-now'} onClick={() => setActiveTab('pay-now')}>
            Pay now
          </TabButton>
          <TabButton active={activeTab === 'pay-later'} onClick={() => setActiveTab('pay-later')}>
            Pay over time
          </TabButton>
        </div>
      )}

      <div className="p-5">
        {activeTab === 'pay-now' && (
          <div className="space-y-4">
            {/* Wallet buttons */}
            <div className="grid grid-cols-2 gap-3">
              <ApplePayButton
                token={checkout.token}
                amount={amount}
                currency={currency}
                country={country}
                onSuccess={onSuccess}
                onError={onError}
              />
              <GooglePayButton
                instanceId={instanceId}
                token={checkout.token}
                amount={amount}
                currency={currency}
                country={country}
                onSuccess={onSuccess}
                onError={onError}
              />
            </div>

            <Divider label="or pay by card" />

            <CardTab
              instanceId={instanceId}
              environment={process.env.NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT ?? 'sandbox'}
              checkoutSessionId={checkout.checkoutSessionId}
              amount={amount}
              currency={currency}
              country={country}
              onSuccess={onSuccess}
              onError={onError}
            />
          </div>
        )}

        {activeTab === 'pay-later' && (
          <BNPLTab
            methods={checkout.payLater}
            amount={amount}
            currency={currency}
            country={country}
            token={checkout.token}
            checkoutSessionId={checkout.checkoutSessionId}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 flex items-center justify-center gap-1.5">
        <svg className="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        <span className="text-xs text-gray-400">Secured by <span className="font-medium text-gray-500">WizloPay</span></span>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-gray-100" />
      <span className="text-xs text-gray-400 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}
