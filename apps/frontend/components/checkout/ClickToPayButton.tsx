'use client';

import { useEffect, useState } from 'react';


interface Props {
  token: string;
  checkoutSessionId: string;
  amount: number;
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export function ClickToPayButton({
  token,
  checkoutSessionId,
  amount,
  currency,
  country,
  onSuccess,
  onError,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!checkoutSessionId || (window as any).__c2pInitialised) return;
    (window as any).__c2pInitialised = true;
    void initClickToPay();
  }, [checkoutSessionId, token]);

  async function initClickToPay() {
    try {
      const sdkUrl = process.env.NEXT_PUBLIC_C2P_SDK_URL;
      if (!sdkUrl) return;

      // Use DPA credentials from env vars if available; otherwise fall back to API session
      let dpaId = process.env.NEXT_PUBLIC_C2P_DPA_ID;
      let dpaName = process.env.NEXT_PUBLIC_C2P_DPA_NAME ?? 'Merchant';

      if (!dpaId) {
        const res = await fetch('/api/checkout/c2p-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ checkoutSessionId }),
        });
        if (!res.ok) return;
        const sessionData = await res.json() as {
          digitalPaymentApplicationId: string;
          digitalPaymentApplicationName: string;
        };
        if (!sessionData?.digitalPaymentApplicationId) return;
        dpaId = sessionData.digitalPaymentApplicationId;
        dpaName = sessionData.digitalPaymentApplicationName ?? dpaName;
      }

      await loadScript(sdkUrl);

      const SRCI = (window as any).SRCI;
      if (!SRCI) return;

      if (!(window as any).__wizloC2PInstance) {
        (window as any).__wizloC2PInstance = new SRCI({ dpaId, dpaName });
      }

      // Show the button regardless of recognized state — C2P handles enrolment too
      setVisible(true);
    } catch {
      // Any failure → silently hide the button, never block the rest of checkout
    }
  }

  async function handleClick() {
    const srci = (window as any).__wizloC2PInstance;
    if (!srci || loading) return;

    setLoading(true);
    try {
      const result = await srci.checkout({
        amount: { totalAmount: (amount / 100).toFixed(2), currencyCode: currency },
        transactionType: 'PURCHASE',
      });

      const response = result?.checkoutResponse;
      if (!response || response.dcfActionCode === 'CANCEL') {
        setLoading(false);
        return;
      }

      // Build payment method — SRCI returns either token+cryptogram or FPAN
      let paymentMethod: Record<string, unknown>;
      if (response?.maskedCard?.pan) {
        paymentMethod = {
          method: 'click-to-pay',
          number: response.maskedCard.pan,
          expirationDate: response.maskedCard.expirationDate,
        };
      } else {
        paymentMethod = {
          method: 'click-to-pay',
          token: response?.encryptedCard?.token ?? response?.token,
          cryptogram: response?.dynamicData?.cryptogram ?? response?.cryptogram,
          expirationDate: response?.dynamicData?.expirationDate ?? response?.expirationDate,
        };
      }

      const res = await fetch('/api/checkout/transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount, currency, country, paymentMethod }),
      });

      const body = await res.json() as { transactionId?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Click to Pay transaction failed');
      onSuccess(body.transactionId!);
    } catch (err) {
      setLoading(false);
      onError(err instanceof Error ? err : new Error('Click to Pay failed'));
    }
  }

  if (!visible) return null;

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="w-full h-[52px] flex items-center justify-center gap-2.5 rounded-[14px] bg-[#002D72] hover:bg-[#001f52] disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-4"
      aria-label="Click to Pay"
    >
      {loading ? (
        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <>
          <svg className="h-5 w-auto" viewBox="0 0 48 28" fill="none">
            <rect x="0" y="4" width="20" height="20" rx="3" fill="#FF5F00" />
            <rect x="28" y="4" width="20" height="20" rx="3" fill="#EB001B" />
            <path d="M24 19.4C25.9 17.9 27.2 15.6 27.2 14C27.2 12.4 25.9 10.1 24 8.6C22.1 10.1 20.8 12.4 20.8 14C20.8 15.6 22.1 17.9 24 19.4Z" fill="#FF5F00" />
          </svg>
          <span className="text-white text-sm font-semibold tracking-wide">Click to Pay</span>
        </>
      )}
    </button>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}
