'use client';

import { useEffect, useState } from 'react';

interface Props {
  token: string;
  amount: number;
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export function ApplePayButton({ token, amount, currency, country, onSuccess, onError }: Props) {
  const [nativeAvailable, setNativeAvailable] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      const canPay = typeof (window as any).ApplePaySession !== 'undefined' &&
        (window as any).ApplePaySession.canMakePayments?.();
      setNativeAvailable(Boolean(canPay));
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  async function handleClick() {
    if (!nativeAvailable) return;

    const ApplePaySession = (window as any).ApplePaySession;
    const amountStr = (amount / 100).toFixed(2);

    const session: any = new ApplePaySession(3, {
      countryCode: country,
      currencyCode: currency,
      merchantCapabilities: ['supports3DS'],
      supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
      total: { label: 'Your Order', type: 'final', amount: amountStr },
    });

    session.onvalidatemerchant = async (event: { validationURL: string }) => {
      try {
        const res = await fetch('/api/checkout/apple-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ validationUrl: event.validationURL }),
        });
        const merchantSession = await res.json();
        session.completeMerchantValidation(merchantSession);
      } catch (err) {
        session.abort();
        onError(err instanceof Error ? err : new Error('Apple Pay merchant validation failed'));
      }
    };

    session.onpaymentauthorized = async (event: { payment: { token: unknown } }) => {
      try {
        const res = await fetch('/api/checkout/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amount,
            currency,
            country,
            checkoutSessionId: '',
            paymentMethod: { method: 'applepay', token: event.payment.token },
          }),
        });
        const { transactionId } = (await res.json()) as { transactionId: string };
        session.completePayment({ status: ApplePaySession.STATUS_SUCCESS });
        onSuccess(transactionId);
      } catch (err) {
        session.completePayment({ status: ApplePaySession.STATUS_FAILURE });
        onError(err instanceof Error ? err : new Error('Apple Pay payment failed'));
      }
    };

    session.begin();
  }

  return (
    <button
      onClick={handleClick}
      disabled={!nativeAvailable}
      aria-label="Pay with Apple Pay"
      className="w-full h-12 rounded-xl bg-black hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
    >
      {/* Apple logo */}
      <svg className="h-5 w-auto" viewBox="0 0 24 24" fill="white">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.32.07 2.22.74 2.98.8 1.12-.23 2.2-.93 3.39-.84 1.44.12 2.53.72 3.22 1.83-2.96 1.77-2.24 5.65.26 6.72-.54 1.5-1.27 2.96-1.85 4.37zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
      <span className="text-white text-sm font-semibold">Pay</span>
    </button>
  );
}
