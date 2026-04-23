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
  const [visible, setVisible] = useState(false);
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
    checkReadyAndInit();
  }, [scriptReady, amount, currency, country, token]);

  async function checkReadyAndInit() {
    const client = new (window as any).google.payments.api.PaymentsClient({ environment });

    try {
      const { result } = await client.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: ALLOWED_PAYMENT_METHODS,
      });
      if (!result) return;
    } catch {
      return;
    }

    // Google Pay requires a real registered domain — skip on localhost
    const domain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? window.location.hostname;
    if (domain === 'localhost' || domain === '127.0.0.1') return;

    let sessionData: { gatewayMerchantId: string; token: string };
    try {
      const res = await fetch('/api/checkout/google-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) return;
      sessionData = (await res.json()) as typeof sessionData;
    } catch {
      return;
    }

    const button = client.createButton({
      buttonSizeMode: 'fill',
      onClick: () => handleGooglePay(client, sessionData),
    });

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(button);
      setVisible(true);
    }
  }

  async function handleGooglePay(
    client: any,
    session: { gatewayMerchantId: string; token: string },
  ) {
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
              gatewayMerchantId: session.gatewayMerchantId,
            },
          },
        }],
        merchantInfo: {
          authJwt: session.token,
          merchantName: 'Your Store',
        },
        transactionInfo: {
          totalPriceStatus: 'FINAL',
          totalPrice: (amount / 100).toFixed(2),
          currencyCode: currency,
          countryCode: country,
        },
      });

      // gr4vy expects the token as a parsed object, not a JSON string
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

  return <div ref={containerRef} className={`w-full h-12 ${visible ? '' : 'hidden'}`} />;
}
