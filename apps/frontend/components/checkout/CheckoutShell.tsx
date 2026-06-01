'use client';

import { useEffect, useState } from 'react';
import { CardTab } from './CardTab';
import { ApplePayButton } from './ApplePayButton';
import { GooglePayButton } from './GooglePayButton';
import { BNPLTab } from './BNPLTab';
import { PlaidButton } from './PlaidButton';
import { AdyenBankButton } from './AdyenBankButton';
import { StripeLinkButton } from './StripeLinkButton';

type Tab = 'card' | 'bank' | 'bnpl';

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
  payByBank: PaymentOption[];
}

interface Props {
  amount: number;
  currency: string;
  country: string;
}

export function CheckoutShell({ amount, currency, country }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('card');
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const instanceId = process.env.NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID ?? '';

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailError(null);
    setEmailLoading(true);
    try {
      const res = await fetch('/api/checkout/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Failed to resolve buyer');
      setBuyerId(body.buyerId);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Something went wrong');
      setEmailLoading(false);
    }
  }

  useEffect(() => {
    if (!buyerId) return;
    setLoading(true);
    Promise.all([
      fetch('/api/checkout/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, buyerId }),
      }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.message); return b; }),
      fetch('/api/checkout/payment-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, country }),
      }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.message); return b; }),
    ])
      .then(([tokenData, optionsData]) => {
        setCheckout({
          token: tokenData.token,
          checkoutSessionId: tokenData.checkoutSessionId,
          payNow: optionsData.payNow ?? [],
          payLater: optionsData.payLater ?? [],
          payByBank: optionsData.payByBank ?? [],
        });
        setEmailLoading(false);
      })
      .catch((err: Error) => { setError(err.message); setEmailLoading(false); })
      .finally(() => setLoading(false));
  }, [buyerId, amount, currency, country]);

  function onSuccess(txId: string) {
    window.location.href = `/checkout/callback?transaction_id=${txId}&transaction_status=capture_succeeded`;
  }
  function onError(err: Error) { setError(err.message); }

  const fmtAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);

  // ── Email gate ──────────────────────────────────────────────────────────────
  if (!buyerId) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100">
          <p className="text-2xl font-bold text-gray-900">{fmtAmount}</p>
          <p className="text-sm text-gray-400 mt-0.5">Enter your email to continue</p>
        </div>
        <div className="px-6 py-5">
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email address</label>
              <input
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#6938EF] transition-colors"
                style={{ boxShadow: 'none' }}
                onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(105,56,239,0.12)'; }}
                onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
              />
            </div>
            {emailError && <p className="text-xs text-red-500">{emailError}</p>}
            <button
              type="submit"
              disabled={emailLoading || !email.trim()}
              className="w-full bg-[#6938EF] hover:bg-[#5526D9] text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {emailLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Continuing…
                </span>
              ) : 'Continue'}
            </button>
          </form>
        </div>
        <Footer />
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 animate-pulse">
          <div className="h-7 w-24 bg-gray-100 rounded-lg" />
          <div className="h-3 w-32 bg-gray-100 rounded mt-2" />
        </div>
        <div className="px-6 py-5 space-y-3 animate-pulse">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="h-12 bg-gray-100 rounded-xl" />
            <div className="h-12 bg-gray-100 rounded-xl" />
          </div>
          <div className="h-11 bg-gray-100 rounded-xl" />
          <div className="h-px bg-gray-100 my-1" />
          <div className="h-8 bg-gray-100 rounded-lg w-1/2" />
          <div className="h-[96px] bg-gray-100 rounded-xl" />
          <div className="h-12 bg-gray-100 rounded-xl" />
        </div>
        <Footer />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center space-y-4">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Something went wrong</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-xs mx-auto">{error}</p>
        </div>
        <button
          onClick={() => { setBuyerId(null); setCheckout(null); setError(null); }}
          className="text-sm font-medium text-[#6938EF] hover:text-[#5526D9] transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!checkout) return null;

  const hasPayLater = checkout.payLater.length > 0;

  // ── Main checkout ────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

      {/* Amount + email header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight text-gray-900">{fmtAmount}</p>
            <p className="text-xs text-gray-400 mt-0.5">Due today</p>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 max-w-[180px]">
            <span className="text-xs text-gray-600 truncate flex-1">{email}</span>
            <button
              onClick={() => { setBuyerId(null); setCheckout(null); setError(null); }}
              className="text-[11px] font-semibold text-[#6938EF] hover:text-[#5526D9] flex-shrink-0 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">

        {/* Express checkout */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <ApplePayButton token={checkout.token} amount={amount} currency={currency} country={country} onSuccess={onSuccess} onError={onError} />
            <GooglePayButton instanceId={instanceId} token={checkout.token} amount={amount} currency={currency} country={country} onSuccess={onSuccess} onError={onError} />
          </div>
          <a
            href={`/checkout/c2p?amount=${amount}&currency=${currency}&country=${country}&buyerId=${buyerId}&email=${encodeURIComponent(email)}`}
            className="flex items-center justify-center gap-2 w-full h-11 bg-[#002D72] hover:bg-[#001f52] rounded-xl no-underline transition-colors"
          >
            <svg className="h-3.5 w-auto" viewBox="0 0 48 28" fill="none">
              <rect x="0" y="4" width="20" height="20" rx="3" fill="#FF5F00"/>
              <rect x="28" y="4" width="20" height="20" rx="3" fill="#EB001B"/>
              <path d="M24 19.4C25.9 17.9 27.2 15.6 27.2 14C27.2 12.4 25.9 10.1 24 8.6C22.1 10.1 20.8 12.4 20.8 14C20.8 15.6 22.1 17.9 24 19.4Z" fill="#FF5F00"/>
            </svg>
            <span className="text-white text-xs font-semibold">Click to Pay</span>
          </a>

          <StripeLinkButton amount={amount} currency={currency} email={email} />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400">or pay another way</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        {/* Method tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          <Tab active={activeTab === 'card'} onClick={() => setActiveTab('card')}>Card</Tab>
          <Tab active={activeTab === 'bank'} onClick={() => setActiveTab('bank')}>Bank</Tab>
          {hasPayLater && (
            <Tab active={activeTab === 'bnpl'} onClick={() => setActiveTab('bnpl')}>Pay later</Tab>
          )}
        </div>

        {/* Tab content */}
        {activeTab === 'card' && (
          <CardTab
            instanceId={instanceId}
            environment={process.env.NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT ?? 'sandbox'}
            checkoutSessionId={checkout.checkoutSessionId}
            amount={amount} currency={currency} country={country}
            buyerId={buyerId}
            onSuccess={onSuccess} onError={onError}
          />
        )}

        {activeTab === 'bank' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Connect your bank account — no card needed.</p>
            <PlaidButton
              token={checkout.token} amount={amount} currency={currency} country={country}
              buyerId={buyerId} onSuccess={onSuccess} onError={onError}
            />
            <AdyenBankButton
              methods={checkout.payByBank.length > 0
                ? checkout.payByBank
                : [{ method: 'pay-by-bank', label: 'Pay by Bank', mode: 'redirect' }]}
              token={checkout.token} amount={amount} currency={currency} country={country}
              checkoutSessionId={checkout.checkoutSessionId} buyerId={buyerId}
            />
          </div>
        )}

        {activeTab === 'bnpl' && (
          <BNPLTab
            methods={checkout.payLater} amount={amount} currency={currency} country={country}
            token={checkout.token} checkoutSessionId={checkout.checkoutSessionId} buyerId={buyerId}
          />
        )}
      </div>

      <Footer />
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
        active ? 'bg-white text-[#6938EF] shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function Footer() {
  return (
    <div className="px-6 py-3.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        <span className="text-[11px] text-gray-400">Secured by <span className="font-semibold text-gray-500">Wizlo</span></span>
      </div>
      <div className="flex items-center gap-1">
        {['Visa', 'MC', 'Amex', 'Discover'].map(c => (
          <span key={c} className="text-[10px] font-semibold text-gray-400 bg-white border border-gray-200 rounded px-1.5 py-0.5">{c}</span>
        ))}
      </div>
    </div>
  );
}
