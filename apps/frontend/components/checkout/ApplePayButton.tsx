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
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      const canPay = typeof (window as any).ApplePaySession !== 'undefined' &&
        (window as any).ApplePaySession.canMakePayments?.();
      setAvailable(Boolean(canPay));
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  async function handleClick() {
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

  if (!available) return null;

  return (
    <button
      onClick={handleClick}
      aria-label="Pay with Apple Pay"
      className="apple-pay-button"
    />
  );
}
