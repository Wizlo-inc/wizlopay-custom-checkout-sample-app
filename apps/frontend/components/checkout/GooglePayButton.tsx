'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  instanceId: string;
  token: string;
  amount: number;
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

const ALLOWED_PAYMENT_METHODS = [{
  type: 'CARD',
  parameters: {
    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
    allowedCardNetworks: ['AMEX', 'DISCOVER', 'MASTERCARD', 'VISA'],
  },
}];

export function GooglePayButton({ instanceId, token, amount, currency, country, onSuccess, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const clientRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const environment = process.env.NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT === 'production' ? 'PRODUCTION' : 'TEST';

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://pay.google.com/gp/p/js/pay.js';
    script.async = true;
    script.onload = () => setScriptReady(true);
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!scriptReady) return;
    initSession();
  }, [scriptReady, amount, currency, country, token]);

  async function initSession() {
    const domain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? window.location.hostname;

    try {
      const res = await fetch('/api/checkout/google-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) return;
      sessionRef.current = await res.json();
      setSdkReady(true);
    } catch {
      // session fetch failed — button stays in fallback state
    }
  }

  async function handleGooglePay() {
    if (!scriptReady) return;

    const client = new (window as any).google.payments.api.PaymentsClient({ environment });
    clientRef.current = client;
    const session = sessionRef.current;

    try {
      const paymentData = await client.loadPaymentData({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [{
          ...ALLOWED_PAYMENT_METHODS[0],
          tokenizationSpecification: {
            type: 'PAYMENT_GATEWAY',
            parameters: {
              gateway: 'gr4vy',
              gatewayMerchantId: session?.gatewayMerchantId ?? '',
            },
          },
        }],
        merchantInfo: {
          authJwt: session?.token ?? token,
          merchantName: 'Your Store',
        },
        transactionInfo: {
          totalPriceStatus: 'FINAL',
          totalPrice: (amount / 100).toFixed(2),
          currencyCode: currency,
          countryCode: country,
        },
      });

      let gpToken: string | Record<string, unknown>;
      try {
        gpToken = JSON.parse(paymentData.paymentMethodData.tokenizationData.token);
      } catch {
        gpToken = paymentData.paymentMethodData.tokenizationData.token;
      }

      const res = await fetch('/api/checkout/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          amount,
          currency,
          country,
          paymentMethod: {
            method: 'googlepay',
            token: gpToken,
            cardSuffix: paymentData.paymentMethodData.info?.cardDetails,
            cardScheme: paymentData.paymentMethodData.info?.cardNetwork,
          },
        }),
      });

      const body = await res.json() as { transactionId?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Google Pay transaction failed');
      onSuccess(body.transactionId!);
    } catch (err) {
      if ((err as any)?.statusCode === 'CANCELED') return;
      onError(err instanceof Error ? err : new Error('Google Pay payment failed'));
    }
  }

  return (
    <button
      onClick={handleGooglePay}
      aria-label="Pay with Google Pay"
      className="w-full h-12 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center justify-center gap-2"
    >
      {/* Google Pay wordmark */}
      <svg className="h-5 w-auto" viewBox="0 0 80 33" xmlns="http://www.w3.org/2000/svg">
        <path d="M38.02 16.47v9.4h-2.99V3.6h7.93a7.16 7.16 0 015.11 1.97 6.53 6.53 0 012.1 4.97 6.53 6.53 0 01-2.1 4.97 7.03 7.03 0 01-5.11 1.96h-4.94zm0-9.87v6.88h5.02a4.1 4.1 0 003.08-1.22 4.1 4.1 0 000-5.84 4.05 4.05 0 00-3.08-1.22l-5.02-.6z" fill="#4285F4"/>
        <path d="M54.28 10.37c2.21 0 3.95.59 5.22 1.78 1.27 1.18 1.9 2.8 1.9 4.86v9.86h-2.86v-2.22h-.13c-1.24 1.83-2.87 2.74-4.93 2.74-1.75 0-3.21-.52-4.38-1.55a4.97 4.97 0 01-1.75-3.9 4.72 4.72 0 011.85-3.88c1.24-.97 2.88-1.46 4.94-1.46 1.76 0 3.2.32 4.35.96v-.67a3.38 3.38 0 00-1.23-2.62 4.42 4.42 0 00-2.97-1.07 4.76 4.76 0 00-4.12 2.18l-2.63-1.65c1.44-2.05 3.58-3.08 6.74-3.08zm-4.07 12.11c0 .78.35 1.43 1.05 1.96.7.53 1.53.8 2.49.8 1.35 0 2.55-.5 3.6-1.5s1.57-2.17 1.57-3.5c-1.01-.8-2.4-1.2-4.2-1.2-1.31 0-2.4.32-3.27.94-.87.63-1.24 1.4-1.24 2.5z" fill="#4285F4"/>
        <path d="M76.4 10.9l-9.97 22.9h-3.08l3.7-7.96-6.55-14.94h3.24l4.74 11.44h.07l4.61-11.44H76.4z" fill="#4285F4"/>
        <path d="M27.38 14.54a16.6 16.6 0 00-.24-2.87H14v5.43h7.52a6.42 6.42 0 01-2.79 4.21v3.5h4.52c2.65-2.43 4.13-6.02 4.13-10.27z" fill="#4285F4"/>
        <path d="M14 29.13c3.77 0 6.93-1.25 9.24-3.39l-4.52-3.5a8.54 8.54 0 01-4.72 1.34 8.5 8.5 0 01-7.97-5.85H1.38v3.6A13.98 13.98 0 0014 29.13z" fill="#34A853"/>
        <path d="M6.03 17.74a8.41 8.41 0 010-5.38V8.76H1.38a14.04 14.04 0 000 12.58l4.65-3.6z" fill="#FBBC04"/>
        <path d="M14 5.57a7.58 7.58 0 015.36 2.1l4-4A13.45 13.45 0 0014 .1 13.98 13.98 0 001.38 8.76l4.65 3.6A8.5 8.5 0 0114 5.57z" fill="#EA4335"/>
      </svg>
    </button>
  );
}
