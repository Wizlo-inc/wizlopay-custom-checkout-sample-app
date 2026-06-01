'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  amount: number;
  currency: string;
  country: string;
  buyerId?: string | null;
  email?: string | null;
}

type Phase = 'loading' | 'sign-in' | 'ready' | 'submitting' | 'success' | 'error';

export function ClickToPayScreen({ amount, currency, country, buyerId, email }: Props) {
  const sfRef = useRef<any>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const c2pAddedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [checkoutSessionId, setCheckoutSessionId] = useState('');

  const instanceId = process.env.NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID ?? '';
  const environment = process.env.NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT ?? 'sandbox';

  // DPA credentials — resolved fully in Step 1 before the script effect fires
  const [srcDpaId, setSrcDpaId] = useState('');
  const [dpaName, setDpaName] = useState('');
  const [token, setToken] = useState('');

  /* ── Step 1: fetch token + c2p session in sequence, set all state at once ── */
  useEffect(() => {
    (async () => {
      try {
        // 1a. Get checkout token
        const tokenRes = await fetch('/api/checkout/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, currency, ...(buyerId && { buyerId }) }),
        });
        const tokenBody = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenBody.message ?? 'Token fetch failed');
        const { token: t, checkoutSessionId: sid } = tokenBody as { token: string; checkoutSessionId: string };

        // 1b. Get c2p session (must complete before we trigger the script effect)
        let resolvedDpaId = process.env.NEXT_PUBLIC_C2P_DPA_ID ?? '';
        let resolvedDpaName = process.env.NEXT_PUBLIC_C2P_DPA_NAME ?? 'Merchant';
        try {
          const c2pRes = await fetch('/api/checkout/c2p-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
            body: JSON.stringify({ checkoutSessionId: sid }),
          });
          const c2pBody = await c2pRes.json();
          console.log('[C2P] session response:', c2pBody, 'ok:', c2pRes.ok);
          if (c2pRes.ok) {
            if (c2pBody.digitalPaymentApplicationId) resolvedDpaId = c2pBody.digitalPaymentApplicationId;
            if (c2pBody.digitalPaymentApplicationName) resolvedDpaName = c2pBody.digitalPaymentApplicationName;
          }
        } catch (e) {
          console.warn('[C2P] c2p-session fetch failed, using env vars:', e);
        }

        console.log('[C2P] resolved srcDpaId:', resolvedDpaId, 'dpaName:', resolvedDpaName);

        // 1c. Set all state in one batch — script effect won't fire until srcDpaId is ready
        setToken(t);
        setSrcDpaId(resolvedDpaId);
        setDpaName(resolvedDpaName);
        setCheckoutSessionId(sid); // triggers Step 2
      } catch (err: any) {
        setErrorMsg(err.message ?? 'Initialisation failed');
        setPhase('error');
      }
    })();
  }, [amount, currency]);

  /* ── Step 2: once session is ready, init Secure Fields + addClickToPay ── */
  useEffect(() => {
    if (!checkoutSessionId || !instanceId || !srcDpaId) return;

    const sfBase = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest`;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${sfBase}/secure-fields.css`;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = `${sfBase}/secure-fields.js`;
    script.async = true;
    script.onload = initSecureFields;
    script.onerror = () => { setErrorMsg('Failed to load Secure Fields'); setPhase('error'); };
    document.head.appendChild(script);

    return () => {
      sfRef.current = null;
      c2pAddedRef.current = false;
      const widget = document.getElementById('c2p-widget');
      if (widget) widget.innerHTML = '';
      if (document.head.contains(link)) document.head.removeChild(link);
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, [checkoutSessionId, instanceId, srcDpaId, dpaName]);

  function initSecureFields() {
    const SecureFields = (window as any).SecureFields;
    if (!SecureFields) { setErrorMsg('Secure Fields not available'); setPhase('error'); return; }

    const sf = new SecureFields({ gr4vyId: instanceId, environment, sessionId: checkoutSessionId });
    sfRef.current = sf;

    if (typeof sf.addClickToPay !== 'function') {
      setErrorMsg('Click to Pay is not available on this account');
      setPhase('error');
      return;
    }

    try {
      if (!c2pAddedRef.current) {
        c2pAddedRef.current = true;
        console.log('[C2P] addClickToPay with srcDpaId:', srcDpaId, 'dpaName:', dpaName, 'email:', email);
        sf.addClickToPay('#c2p-widget', {
          srcDpaId,
          dpaName,
          dpaLocale: 'en_US',
          cardBrands: ['mastercard', 'visa', 'american-express'],
          ...(email ? { email } : { signIn: '#c2p-sign-in' }),
          consentCheckbox: '#c2p-consent-checkbox',
          learnMoreLink: '#c2p-learn-more',
        });
      }
      setPhase('sign-in');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to initialise Click to Pay');
      setPhase('error');
      return;
    }

    sf.addEventListener(SecureFields.Events.CLICK_TO_PAY_INITIALIZED, () => { /* DPA loaded */ });

    // User chose to pay with a new (unenrolled) card — send them to the card form
    sf.addEventListener(SecureFields.Events.CLICK_TO_PAY_CHECKOUT_WITH_NEW_CARD, () => {
      window.location.href = '/checkout';
    });

    // CLICK_TO_PAY_READY: user is recognised, stored cards are available
    sf.addEventListener(SecureFields.Events.CLICK_TO_PAY_READY, () => {
      setPhase('ready');
    });

    // CARD_VAULT_SUCCESS: card captured — create the transaction
    sf.addEventListener(SecureFields.Events.CARD_VAULT_SUCCESS, async () => {
      try {
        const payload = {
          amount,
          currency,
          country,
          ...(buyerId && { buyerId }),
          paymentMethod: {
            method: 'checkout-session',
            id: checkoutSessionId,
            redirectUrl: `${window.location.origin}/checkout/callback`,
          },
        };
        console.log('[C2P] creating transaction:', payload);
        const res = await fetch('/api/checkout/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { transactionId?: string; status?: string; message?: string };
        console.log('[C2P] transaction response:', res.status, body);
        if (!res.ok) throw new Error(body.message ?? `Transaction failed (${res.status})`);
        setPhase('success');
        setTimeout(() => {
          window.location.href = `/checkout/callback?transaction_id=${body.transactionId}&transaction_status=${body.status ?? 'capture_succeeded'}`;
        }, 1200);
      } catch (err: any) {
        console.error('[C2P] transaction error:', err);
        setErrorMsg(err?.message ?? 'Payment failed');
        setPhase('error');
      }
    });

    sf.addEventListener(SecureFields.Events.CARD_VAULT_FAILURE, (data: any) => {
      setErrorMsg(data?.message ?? 'Card could not be processed');
      setPhase('error');
    });

    sf.addEventListener(SecureFields.Events.CLICK_TO_PAY_ERROR, ({ error }: any) => {
      if (error?.code === 'RETRIES_EXCEEDED' || error?.code === 'SIGN_OUT_FAILED') {
        setErrorMsg('Click to Pay is unavailable. Please try another payment method.');
        setPhase('error');
      }
    });

    // CLICK_TO_PAY_UNABLE_TO_LOAD_DPA: DPA not configured for this environment
    sf.addEventListener(SecureFields.Events.CLICK_TO_PAY_UNABLE_TO_LOAD_DPA, () => {
      setErrorMsg('Click to Pay is not configured for this environment.');
      setPhase('error');
    });
  }

  function handleSignIn() {
    const sf = sfRef.current;
    const email = emailRef.current?.value?.trim();
    if (!sf || !email) return;
    sf.clickToPay?.signIn({ email });
  }

  function handlePay() {
    const sf = sfRef.current;
    if (!sf || phase !== 'ready') return;
    setPhase('submitting');
    sf.submit();
  }

  const fmtAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-10 overflow-x-hidden">
      <div className="w-full max-w-md mx-auto space-y-4">

        {/* Wizlo wordmark */}
        <div className="flex items-center gap-2 mb-3 justify-center">
          <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
            <path d="M0 0h4.8l3.6 12L12 0h4l3.6 12L23.2 0H28l-6 20h-4.4L14 8l-3.6 12H6L0 0Z" fill="#6938EF"/>
          </svg>
          <span className="text-[15px] font-bold tracking-widest text-gray-900 uppercase">Wizlo</span>
        </div>

        {/* Back link */}
        <a
          href="/checkout"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors no-underline"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to checkout
        </a>

        {/* Order card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-[#6938EF] flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">Demo Product</p>
            <p className="text-xs text-gray-500 mt-0.5">Qty 1 · Ships in 2–3 days</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{fmtAmount}</p>
            <p className="text-xs text-gray-400">{currency}</p>
          </div>
        </div>

        {/* C2P card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden w-full">

          {/* Header */}
          <div className="bg-[#002D72] px-5 py-4 flex items-center gap-3">
            <svg className="h-7 w-auto flex-shrink-0" viewBox="0 0 56 32" fill="none">
              <rect x="0" y="4" width="24" height="24" rx="12" fill="#EB001B" />
              <rect x="32" y="4" width="24" height="24" rx="12" fill="#FF5F00" />
              <path d="M28 8.5C30.8 10.5 32.8 13.1 32.8 16C32.8 18.9 30.8 21.5 28 23.5C25.2 21.5 23.2 18.9 23.2 16C23.2 13.1 25.2 10.5 28 8.5Z" fill="#FF5F00" />
            </svg>
            <div>
              <p className="text-white font-semibold text-sm">Click to Pay</p>
              <p className="text-blue-300 text-xs mt-0.5">Fast, secure checkout</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Amount row */}
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-500">Total due</span>
              <span className="text-base font-bold text-gray-900">{fmtAmount}</span>
            </div>

            {/* Sign-in form — only rendered when no email was pre-supplied */}
            {!email && (
              <div id="c2p-sign-in" className="space-y-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Access your Click to Pay cards</p>
                <div className="flex gap-2">
                  <input
                    ref={emailRef}
                    type="email"
                    placeholder="Email address"
                    className="flex-1 h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6938EF]/20 focus:border-[#6938EF] transition"
                  />
                  <button
                    onClick={handleSignIn}
                    className="h-10 px-4 rounded-lg bg-[#002D72] text-white text-sm font-semibold hover:bg-[#001f52] transition-colors whitespace-nowrap"
                  >
                    Sign in
                  </button>
                </div>
              </div>
            )}

            {/* Consent checkbox — always shown */}
            <div className="flex items-start gap-2">
              <input type="checkbox" id="c2p-consent-checkbox" className="mt-0.5 accent-[#6938EF]" />
              <label htmlFor="c2p-consent-checkbox" className="text-xs text-gray-500 leading-relaxed">
                Store my card with Click to Pay.{' '}
                <a href="#" id="c2p-learn-more" className="text-[#6938EF] underline">Learn more</a>
              </label>
            </div>

            {/* Click to Pay widget — SecureFields renders stored cards here */}
            <div id="c2p-widget" className="w-full overflow-hidden" />

            {/* Loading state */}
            {phase === 'loading' && (
              <div className="flex items-center justify-center gap-2 py-4">
                <svg className="animate-spin h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-xs text-gray-400">Initialising Click to Pay…</span>
              </div>
            )}

            {/* Pay button */}
            {phase === 'ready' && (
              <button
                onClick={handlePay}
                className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-[#002D72] hover:bg-[#001f52] active:scale-[0.98] transition-all text-white text-sm font-semibold"
              >
                Pay {fmtAmount} with Click to Pay
              </button>
            )}

            {phase === 'submitting' && (
              <button disabled className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-[#002D72] opacity-70 cursor-not-allowed text-white text-sm font-semibold">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Processing…
              </button>
            )}

            {phase === 'success' && (
              <div className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-green-500 text-white text-sm font-semibold">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Payment successful
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-start gap-3">
                  <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-red-700">{errorMsg || 'Something went wrong'}</p>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full h-10 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-4 flex items-center justify-center gap-1.5 border-t border-gray-100 pt-3">
            <svg className="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-gray-400">Secured by <span className="font-semibold text-[#6938EF]">Wizlo</span></span>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400">
          By completing your purchase you agree to our{' '}
          <span className="underline cursor-pointer hover:text-gray-600 transition-colors">Terms of Service</span>
        </p>
      </div>
    </main>
  );
}
