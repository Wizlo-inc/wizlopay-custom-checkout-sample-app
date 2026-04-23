# WizloPay Custom Checkout Integration Guide

> **Live docs:** https://docs.wizlopay.com/guides/get-started
> All code examples are sourced from live documentation.

---

## Section 1 — Stack Summary

| | |
|---|---|
| **Backend** | NestJS (Node.js / TypeScript) |
| **Frontend** | Next.js (TypeScript) |
| **Database** | PostgreSQL |
| **Existing provider** | Stripe |
| **Environment** | Sandbox first |
| **Checkout mode** | Custom (no Embed) — Direct API + Secure Fields |

---

## Section 2 — Concept Map (Stripe → WizloPay)

| Stripe Concept | WizloPay Equivalent | Key Difference |
|---|---|---|
| Secret Key | API Key | Never expose to client — same rule |
| Publishable Key | **Instance ID** | Used on both backend and frontend (no separate "publishable" concept) |
| Customer ID | **Buyer ID** | **Not optional.** Must be stored and passed on every checkout |
| PaymentIntent | Transaction | Created server-side; no client-side `confirmCardPayment` step |
| PaymentIntent `client_secret` | **JWT Token** | Scoped, short-lived, signed server-side with ES512 |
| Stripe Elements | **Secure Fields** | Hosted iframes; card data never touches your server |
| Checkout Session | Checkout Session | Similar concept — tracks multiple payment attempts for one purchase |
| Webhook `payment_intent.succeeded` | `transaction.capture.succeeded` | Signature uses HMAC-SHA256 not Stripe's own scheme |
| Stripe.js | **`@gr4vy/sdk`** | Both client and server packages available |

**Critical behavioral differences:**

- **JWT replaces publishable key** — you generate a signed JWT server-side for every checkout, not a static client-side key.
- **Buyer ID is mandatory** — not optional like Stripe's Customer ID. Every transaction must be linked to a buyer.
- **Transactions are created server-side** for BNPL (Klarna, Affirm) and wallet payments. Secure Fields handles cards differently — fields tokenize client-side, then your server creates the transaction.
- **No redirect-back for cards** — only BNPL (Klarna, Affirm) uses a redirect flow. Card, Apple Pay, and Google Pay complete inline.

---

## Section 3 — Architecture Overview: Two-Tab Checkout

Your checkout has two tabs. Here is how each payment method works under the hood:

```
Tab 1: Pay Now
├── Card         → Secure Fields (PCI-compliant hosted iframes) + server transaction
├── Google Pay   → Google Pay JS SDK + /digital-wallets/google/session + server transaction
└── Apple Pay    → Apple Pay JS SDK + /digital-wallets/apple/session + server transaction

Tab 2: Pay Over Time
├── Klarna       → Server creates transaction → redirect to Klarna → redirect back
└── Affirm       → Server creates transaction → redirect to Affirm → redirect back
```

Both tabs share:
- JWT token generated per checkout session (NestJS backend)
- Buyer ID lookup / creation before any transaction
- Webhook endpoint for final payment confirmation

---

## Section 4 — Integration Checklist

### Step 1 — API Credentials

- [ ] Log in to the WizloPay Dashboard → **Settings → API keys**
- [ ] Generate an **API Key** (server-side only — treat like a database password)
- [ ] Note your **Instance ID** (visible in the dashboard URL or settings — looks like `sandbox.example`)
- [ ] Store both in NestJS environment variables:

```env
WIZLOPAY_API_KEY=your-api-key
WIZLOPAY_INSTANCE_ID=sandbox.example
WIZLOPAY_ENVIRONMENT=sandbox
```

**Never** commit these to source control. Never expose `WIZLOPAY_API_KEY` to the Next.js client bundle — only `WIZLOPAY_INSTANCE_ID` may be shared with the frontend.

---

### Step 2 — Install the SDK

**Backend (NestJS):**

```bash
npm install @gr4vy/sdk
```

**Frontend (Next.js):**

```bash
npm install @gr4vy/embed-react
# or for Secure Fields specifically:
npm install @gr4vy/secure-fields
```

---

### Step 3 — JWT Token Generation (NestJS)

Create a dedicated service that generates a signed JWT per checkout. This token is scoped to a single transaction attempt and expires in 30 seconds for checkout initiation.

**`src/payments/jwt.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import Gr4vy from '@gr4vy/sdk';

@Injectable()
export class JwtService {
  private readonly client: Gr4vy;

  constructor() {
    this.client = new Gr4vy({
      id: process.env.WIZLOPAY_INSTANCE_ID,
      privateKey: process.env.WIZLOPAY_PRIVATE_KEY, // ES512 private key
      environment: process.env.WIZLOPAY_ENVIRONMENT as 'sandbox' | 'production',
    });
  }

  async generateCheckoutToken(params: {
    amount: number;       // in minor units (cents)
    currency: string;     // e.g. "USD"
    buyerExternalId: string; // your internal user ID
  }): Promise<{ token: string; checkoutSessionId: string }> {
    // Create a checkout session to track multiple payment attempts
    const session = await this.client.checkoutSessions.create({
      amount: params.amount,
      currency: params.currency,
    });

    // Generate scoped JWT — valid for 30 seconds, tied to this session
    const token = await this.client.generateToken({
      scopes: ['transactions.create', 'payment-options.list'],
      checkoutSessionId: session.id,
      embed: {
        amount: params.amount,
        currency: params.currency,
        buyerExternalIdentifier: params.buyerExternalId,
      },
    });

    return { token, checkoutSessionId: session.id };
  }
}
```

**`src/payments/payments.controller.ts`** — expose a token endpoint to Next.js:

```ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { AuthGuard } from '../auth/auth.guard'; // your existing auth

@Controller('checkout')
export class PaymentsController {
  constructor(private readonly jwtService: JwtService) {}

  @Post('token')
  @UseGuards(AuthGuard)
  async getCheckoutToken(
    @Req() req,
    @Body() body: { amount: number; currency: string },
  ) {
    const { token, checkoutSessionId } = await this.jwtService.generateCheckoutToken({
      amount: body.amount,
      currency: body.currency,
      buyerExternalId: req.user.id, // your internal user ID
    });

    return { token, checkoutSessionId };
  }
}
```

> **Note:** JWT tokens expire quickly. Generate a fresh token when the checkout page loads. Do not cache or reuse tokens across page views.

---

### Step 4 — Fetch Available Payment Options (NestJS)

Before rendering the checkout tabs, fetch which payment methods are eligible for this transaction. This is what drives the split between Tab 1 and Tab 2.

```ts
// In your PaymentsController
@Post('payment-options')
@UseGuards(AuthGuard)
async getPaymentOptions(
  @Body() body: { amount: number; currency: string; country: string },
) {
  const options = await this.client.paymentOptions.list({
    amount: body.amount,
    currency: body.currency,
    country: body.country,
  });

  return {
    // Tab 1: immediate payment methods
    payNow: options.items.filter(m =>
      ['card', 'applepay', 'googlepay'].includes(m.method)
    ),
    // Tab 2: BNPL methods
    payLater: options.items.filter(m =>
      ['klarna', 'affirm'].includes(m.method)
    ),
  };
}
```

Response shape per item:

```json
{
  "type": "payment-option",
  "method": "klarna",
  "icon_url": "https://...",
  "mode": "redirect",
  "label": "Klarna",
  "can_store_payment_method": true,
  "can_delay_capture": false
}
```

---

### Step 5 — Tab 1: Card via Secure Fields (Next.js)

Secure Fields renders hosted card input fields (iframes) in your UI. Card data is tokenized client-side and never reaches your servers — reducing your PCI scope.

**`app/checkout/components/CardTab.tsx`**

```tsx
'use client';

import { useEffect, useRef } from 'react';

interface CardTabProps {
  token: string;
  instanceId: string;
  amount: number;
  currency: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export function CardTab({ token, instanceId, amount, currency, onSuccess, onError }: CardTabProps) {
  const secureFieldsRef = useRef<any>(null);

  useEffect(() => {
    // Load the Secure Fields script dynamically
    const script = document.createElement('script');
    script.src = `https://cdn.${instanceId}.gr4vy.app/secure-fields/v1/secure-fields.js`;
    script.onload = () => initSecureFields();
    document.head.appendChild(script);

    return () => document.head.removeChild(script);
  }, [instanceId]);

  function initSecureFields() {
    const sf = new (window as any).SecureFields(instanceId, token);
    secureFieldsRef.current = sf;

    sf.addCardNumberField({
      placeholder: 'Card number',
      styles: {
        color: '#111827',
        fontSize: '16px',
        '::placeholder': { color: '#9ca3af' },
        ':focus': { color: '#111827' },
        ':invalid': { color: '#ef4444' },
      },
    });

    sf.addExpirationDateField({ placeholder: 'MM / YY' });
    sf.addSecurityCodeField({ placeholder: 'CVV' });

    // Listen for card network to show logo
    sf.cardNumberField?.addEventListener('input', (evt: any) => {
      if (evt.schema) {
        // update card logo in your UI based on evt.schema (e.g. "visa", "mastercard")
      }
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secureFieldsRef.current) return;

    try {
      const result = await secureFieldsRef.current.submit({
        amount,
        currency,
      });
      onSuccess(result.transactionId);
    } catch (err) {
      onError(err as Error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Card number</label>
        <div id="card-number" className="secure-field-container" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Expiry</label>
          <div id="expiration-date" className="secure-field-container" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
          <div id="security-code" className="secure-field-container" />
        </div>
      </div>
      <button type="submit" className="w-full bg-black text-white py-3 rounded-lg font-medium">
        Pay {new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)}
      </button>
    </form>
  );
}
```

---

### Step 6 — Tab 1: Apple Pay (Next.js)

Apple Pay requires domain registration in the WizloPay Dashboard first.

**Dashboard setup:**
1. Connections → Apple Pay → Domains → Add your domain
2. Download the Domain Association File
3. Serve it at `https://yourdomain.com/.well-known/apple-developer-merchantid-domain-association`

**In Next.js, add the static file:**

Create `public/.well-known/apple-developer-merchantid-domain-association` and paste the file content.

**`app/checkout/components/ApplePayButton.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

interface ApplePayButtonProps {
  token: string;
  amount: number;       // minor units
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export function ApplePayButton({ token, amount, currency, country, onSuccess, onError }: ApplePayButtonProps) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.crossOrigin = 'anonymous';
    script.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';
    script.onload = () => {
      setAvailable((window as any).ApplePaySession?.canMakePayments?.() ?? false);
    };
    document.head.appendChild(script);
  }, []);

  async function handleApplePay() {
    const amountInDollars = (amount / 100).toFixed(2);

    const session = new (window as any).ApplePaySession(3, {
      countryCode: country,
      currencyCode: currency,
      merchantCapabilities: ['supports3DS'],
      supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
      total: {
        label: 'Your Store',
        type: 'final',
        amount: amountInDollars,
      },
    });

    session.onvalidatemerchant = async (event: any) => {
      const res = await fetch('/api/checkout/apple-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ validationUrl: event.validationURL }),
      });
      const merchantSession = await res.json();
      session.completeMerchantValidation(merchantSession);
    };

    session.onpaymentauthorized = async (event: any) => {
      try {
        const res = await fetch('/api/checkout/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amount,
            currency,
            country,
            paymentMethod: {
              method: 'applepay',
              token: event.payment.token,
            },
          }),
        });
        const { transactionId } = await res.json();
        session.completePayment({ status: (window as any).ApplePaySession.STATUS_SUCCESS });
        onSuccess(transactionId);
      } catch (err) {
        session.completePayment({ status: (window as any).ApplePaySession.STATUS_FAILURE });
        onError(err as Error);
      }
    };

    session.begin();
  }

  if (!available) return null;

  return (
    <button
      onClick={handleApplePay}
      style={{ WebkitAppearance: '-apple-pay-button' } as any}
      className="apple-pay-button w-full h-12 rounded-lg"
    />
  );
}
```

**NestJS proxy endpoint for Apple Pay merchant session:**

```ts
@Post('apple-session')
@UseGuards(AuthGuard)
async applePaySession(@Body() body: { validationUrl: string }) {
  const session = await fetch(
    `https://api.${process.env.WIZLOPAY_ENVIRONMENT}.${process.env.WIZLOPAY_INSTANCE_ID}.gr4vy.app/digital-wallets/apple/session`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.jwtService.generateServerToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        validation_url: body.validationUrl,
        domain_name: process.env.APP_DOMAIN,
      }),
    }
  );
  return session.json();
}
```

---

### Step 7 — Tab 1: Google Pay (Next.js)

**Dashboard setup:**
Connections → Catalog → Google Pay → configure merchant name and add your domain.

**`app/checkout/components/GooglePayButton.tsx`**

```tsx
'use client';

import { useEffect, useRef } from 'react';

interface GooglePayButtonProps {
  instanceId: string;
  token: string;
  amount: number;
  currency: string;
  country: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export function GooglePayButton({ instanceId, token, amount, currency, country, onSuccess, onError }: GooglePayButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://pay.google.com/gp/p/js/pay.js';
    script.onload = () => initGooglePay();
    document.head.appendChild(script);
  }, []);

  async function initGooglePay() {
    // Fetch gateway credentials from your backend
    const res = await fetch('/api/checkout/google-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ domain: window.location.hostname }),
    });
    const { gatewayMerchantId, authJwt, merchantId } = await res.json();

    const paymentsClient = new (window as any).google.payments.api.PaymentsClient({
      environment: 'TEST', // change to 'PRODUCTION' when live
    });

    const button = paymentsClient.createButton({
      onClick: () => handleGooglePay(paymentsClient, { gatewayMerchantId, authJwt, merchantId }),
      buttonSizeMode: 'fill',
    });

    containerRef.current?.appendChild(button);
  }

  async function handleGooglePay(client: any, { gatewayMerchantId, authJwt, merchantId }: any) {
    const paymentData = await client.loadPaymentData({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [{
        type: 'CARD',
        parameters: { allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['AMEX', 'DISCOVER', 'MASTERCARD', 'VISA'] },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: { gateway: 'gr4vy', gatewayMerchantId },
        },
      }],
      merchantInfo: { authJwt, merchantId, merchantName: 'Your Store', merchantOrigin: window.location.hostname },
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: (amount / 100).toFixed(2),
        currencyCode: currency,
        countryCode: country,
      },
    });

    const res = await fetch('/api/checkout/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        amount,
        currency,
        country,
        paymentMethod: {
          method: 'googlepay',
          token: paymentData.paymentMethodData.tokenizationData.token,
          cardSuffix: paymentData.paymentMethodData.info.cardDetails,
          cardScheme: paymentData.paymentMethodData.info.cardNetwork,
          redirectUrl: `${window.location.origin}/checkout/callback`,
        },
      }),
    });
    const { transactionId } = await res.json();
    onSuccess(transactionId);
  }

  return <div ref={containerRef} className="w-full" />;
}
```

**NestJS proxy for Google Pay session:**

```ts
@Post('google-session')
@UseGuards(AuthGuard)
async googlePaySession(@Body() body: { domain: string }) {
  const res = await fetch(
    `https://api.${process.env.WIZLOPAY_ENVIRONMENT}.${process.env.WIZLOPAY_INSTANCE_ID}.gr4vy.app/digital-wallets/google/session`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.jwtService.generateServerToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ origin_domain: body.domain }),
    }
  );
  return res.json(); // returns { gatewayMerchantId, token (authJwt), merchantId }
}
```

---

### Step 8 — Tab 2: BNPL (Klarna + Affirm) — Frontend

This is the critical UX piece. The BNPL tab needs to communicate that these are financing options **before** the user clicks. Based on your requirements:

- Show "Pay over time" clearly in the tab label
- Show per-method messaging in the collapsed/preview state
- Accordion body should explain the option, not just say "you'll be redirected"

**`app/checkout/components/BNPLTab.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface BNPLMethod {
  method: 'klarna' | 'affirm';
  icon_url: string;
  label: string;
}

interface BNPLTabProps {
  methods: BNPLMethod[];
  amount: number;
  currency: string;
  country: string;
  token: string;
  checkoutSessionId: string;
  cartItems: CartItem[];
}

interface CartItem {
  name: string;
  quantity: number;
  unitAmount: number;
}

export function BNPLTab({ methods, amount, currency, country, token, checkoutSessionId, cartItems }: BNPLTabProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const bnplMessaging: Record<string, { tagline: string; description: string; cta: string }> = {
    klarna: {
      tagline: 'Pay in 4 interest-free installments',
      description: `Split your purchase into 4 payments of ${formatAmount(amount / 4, currency)} every 2 weeks. No interest, no fees when you pay on time. Klarna will do a soft credit check that won't affect your credit score.`,
      cta: 'Continue with Klarna',
    },
    affirm: {
      tagline: `As low as ${formatMonthly(amount)} / month`,
      description: `Pay over 3, 6, or 12 months with Affirm. Rates from 0–36% APR. Checking your rate won't affect your credit score. Available on US orders only.`,
      cta: 'Continue with Affirm',
    },
  };

  async function handleSelect(method: 'klarna' | 'affirm') {
    setLoading(true);
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
          cartItems,
          redirectUrl: `${window.location.origin}/checkout/callback`,
        }),
      });
      const { approvalUrl } = await res.json();
      window.location.href = approvalUrl;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-4">
        Choose a financing option below. Your order won't be charged until you complete approval.
      </p>

      {methods.map((m) => {
        const msg = bnplMessaging[m.method];
        const isOpen = selected === m.method;

        return (
          <div
            key={m.method}
            className={`border rounded-xl overflow-hidden transition-all ${isOpen ? 'border-black' : 'border-gray-200'}`}
          >
            {/* Collapsed row — shows method + tagline at a glance */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              onClick={() => setSelected(isOpen ? null : m.method)}
            >
              <div className="flex items-center gap-3">
                <img src={m.icon_url} alt={m.label} className="h-6 w-auto" />
                <div>
                  <span className="font-medium text-gray-900">{m.label}</span>
                  {/* Financing indicator visible in collapsed state — this is what users need to see */}
                  <span className="ml-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    Pay over time
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">{msg.tagline}</p>
                </div>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded — explains the option, not just "you'll be redirected" */}
            {isOpen && (
              <div className="px-4 pb-4 border-t border-gray-100">
                <p className="text-sm text-gray-600 mt-3 mb-4">{msg.description}</p>
                <button
                  onClick={() => handleSelect(m.method as 'klarna' | 'affirm')}
                  disabled={loading}
                  className="w-full bg-black text-white py-3 rounded-lg font-medium disabled:opacity-50"
                >
                  {loading ? 'Redirecting...' : msg.cta}
                </button>
                <p className="text-xs text-gray-400 text-center mt-2">
                  You'll be taken to {m.label} to complete your application. You'll return here once approved.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatAmount(amountInCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountInCents / 100);
}

function formatMonthly(totalCents: number) {
  // Approximate 6-month estimate
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCents / 100 / 6);
}
```

---

### Step 9 — BNPL Transaction Creation (NestJS)

Both Klarna and Affirm use the same redirect pattern server-side. Affirm additionally requires `cartItems`.

```ts
// src/payments/payments.controller.ts

@Post('bnpl')
@UseGuards(AuthGuard)
async createBnplTransaction(
  @Req() req,
  @Body() body: {
    method: 'klarna' | 'affirm';
    amount: number;
    currency: string;
    country: string;
    checkoutSessionId: string;
    cartItems: CartItem[];
    redirectUrl: string;
  },
) {
  const transaction = await this.client.transactions.create({
    amount: body.amount,
    currency: body.currency,
    country: body.country,
    checkoutSessionId: body.checkoutSessionId,
    paymentMethod: {
      method: body.method,
      redirectUrl: body.redirectUrl,
    },
    // Affirm requires cart items; Klarna accepts them for better approval rates
    ...(body.cartItems?.length && {
      cartItems: body.cartItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
      })),
    }),
    // Buyer linkage — always pass buyer so WizloPay can track this customer
    buyer: {
      externalIdentifier: req.user.id,
    },
  });

  // Persist the pending transaction to your DB immediately
  await this.ordersService.createPendingTransaction({
    userId: req.user.id,
    wizlopayTransactionId: transaction.id,
    checkoutSessionId: body.checkoutSessionId,
    status: 'pending',
    amount: body.amount,
    currency: body.currency,
  });

  // Return the approval URL for the frontend to redirect to
  return {
    transactionId: transaction.id,
    approvalUrl: transaction.approvalUrl, // Klarna / Affirm hosted page
  };
}
```

> **Affirm-specific:** `approvalUrl` expires after **30 minutes**. `country` must be `"US"` and `currency` must be `"USD"`. Affirm does not support payment tokenization.

> **Klarna:** Available in 20+ countries. Supports `store: true` for recurring payments.

---

### Step 10 — BNPL Redirect Callback

After the customer approves on Klarna or Affirm, they are sent back to your `redirectUrl`. Create a Next.js route to handle this:

**`app/checkout/callback/page.tsx`**

```tsx
import { redirect } from 'next/navigation';

export default async function CheckoutCallback({
  searchParams,
}: {
  searchParams: { transaction_id?: string; transaction_status?: string };
}) {
  const { transaction_id, transaction_status } = searchParams;

  if (!transaction_id) redirect('/checkout?error=missing_transaction');

  // Show pending state — do NOT confirm order here.
  // Final confirmation comes from the webhook (Step 11).
  if (transaction_status === 'buyer_approval_pending') {
    return <PendingUI transactionId={transaction_id} />;
  }

  if (['capture_succeeded', 'authorization_succeeded'].includes(transaction_status ?? '')) {
    // Show optimistic success — webhook will confirm
    return <SuccessUI transactionId={transaction_id} />;
  }

  return <ErrorUI status={transaction_status} />;
}
```

---

### Step 11 — Webhooks (NestJS)

Webhooks are the source of truth for all payment states. The frontend redirect status is informational only.

**`src/webhooks/webhooks.controller.ts`**

```ts
import { Controller, Post, Req, Res, Headers, RawBodyRequest } from '@nestjs/common';
import { verifyWebhook } from '@gr4vy/sdk';
import { Request, Response } from 'express';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly buyersService: BuyersService,
  ) {}

  @Post('wizlopay')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('x-gr4vy-webhook-signatures') signaturesHeader: string,
    @Headers('x-gr4vy-webhook-timestamp') timestampHeader: string,
    @Headers('x-gr4vy-webhook-id') webhookId: string,
  ) {
    // Always return 200 fast — process asynchronously
    res.status(200).send('OK');

    // Verify signature before processing
    try {
      verifyWebhook(
        req.rawBody!.toString(),
        process.env.WIZLOPAY_WEBHOOK_SECRET!,
        signaturesHeader,
        timestampHeader,
        300, // reject events older than 5 minutes
      );
    } catch {
      return; // invalid signature — silently drop
    }

    const event = JSON.parse(req.rawBody!.toString());

    // Idempotency — skip if already processed
    if (await this.ordersService.isWebhookProcessed(webhookId)) return;
    await this.ordersService.markWebhookProcessed(webhookId);

    switch (event.type) {
      case 'transaction.capture.succeeded':
        await this.ordersService.confirmPayment(event.data.id);
        break;

      case 'transaction.capture.declined':
      case 'transaction.capture.failed':
        await this.ordersService.failPayment(event.data.id, event.type);
        break;

      case 'buyer.created':
        // Store WizloPay Buyer ID on your user record
        await this.buyersService.storeWizlopayBuyerId(
          event.data.external_identifier,
          event.data.id,
        );
        break;
    }
  }
}
```

**NestJS raw body setup** (required for signature verification):

```ts
// main.ts
app.use('/webhooks/wizlopay', express.raw({ type: 'application/json' }));
```

Register webhook URL in WizloPay Dashboard: **Settings → Manage Integrations → Webhook subscriptions → Add subscription**.

---

### Step 12 — Database Schema (PostgreSQL)

Add these columns to your existing tables. Use a migration tool (TypeORM, Prisma, or raw SQL).

```sql
-- On your users table
ALTER TABLE users
  ADD COLUMN wizlopay_buyer_id UUID,
  ADD COLUMN wizlopay_external_identifier TEXT; -- same as your user.id passed to WizloPay

CREATE INDEX idx_users_wizlopay_buyer_id ON users (wizlopay_buyer_id);

-- On your orders / transactions table
ALTER TABLE orders
  ADD COLUMN wizlopay_transaction_id UUID,
  ADD COLUMN wizlopay_checkout_session_id UUID,
  ADD COLUMN payment_status TEXT DEFAULT 'pending',
  ADD COLUMN payment_method TEXT; -- 'card', 'applepay', 'googlepay', 'klarna', 'affirm'

CREATE INDEX idx_orders_wizlopay_transaction_id ON orders (wizlopay_transaction_id);

-- Webhook idempotency table
CREATE TABLE processed_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id TEXT UNIQUE NOT NULL, -- X-Gr4vy-Webhook-ID header value
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_processed_webhooks_webhook_id ON processed_webhooks (webhook_id);
```

---

### Step 13 — Assemble the Two-Tab Checkout Page (Next.js)

**`app/checkout/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { CardTab } from './components/CardTab';
import { ApplePayButton } from './components/ApplePayButton';
import { GooglePayButton } from './components/GooglePayButton';
import { BNPLTab } from './components/BNPLTab';

type Tab = 'pay-now' | 'pay-later';

export default function CheckoutPage() {
  const [activeTab, setActiveTab] = useState<Tab>('pay-now');
  const [checkoutData, setCheckoutData] = useState<{
    token: string;
    checkoutSessionId: string;
    payNowMethods: any[];
    payLaterMethods: any[];
  } | null>(null);

  const amount = 4999; // 49.99 USD in cents — replace with your cart total
  const currency = 'USD';
  const country = 'US';

  useEffect(() => {
    async function init() {
      const [tokenRes, optionsRes] = await Promise.all([
        fetch('/api/checkout/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, currency }),
        }),
        fetch('/api/checkout/payment-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, currency, country }),
        }),
      ]);

      const { token, checkoutSessionId } = await tokenRes.json();
      const { payNow, payLater } = await optionsRes.json();

      setCheckoutData({ token, checkoutSessionId, payNowMethods: payNow, payLaterMethods: payLater });
    }

    init();
  }, []);

  if (!checkoutData) return <div className="text-center py-12">Loading checkout...</div>;

  const { token, checkoutSessionId, payNowMethods, payLaterMethods } = checkoutData;

  return (
    <div className="max-w-md mx-auto py-10 px-4">
      <div className="mb-6">
        <div className="flex border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setActiveTab('pay-now')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'pay-now'
                ? 'bg-black text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Pay now
          </button>
          <button
            onClick={() => setActiveTab('pay-later')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'pay-later'
                ? 'bg-black text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Pay over time
          </button>
        </div>
      </div>

      {activeTab === 'pay-now' && (
        <div className="space-y-4">
          {/* Digital wallets first */}
          <div className="grid grid-cols-2 gap-3">
            <ApplePayButton
              token={token}
              amount={amount}
              currency={currency}
              country={country}
              onSuccess={(id) => console.log('Apple Pay success', id)}
              onError={(e) => console.error(e)}
            />
            <GooglePayButton
              instanceId={process.env.NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID!}
              token={token}
              amount={amount}
              currency={currency}
              country={country}
              onSuccess={(id) => console.log('Google Pay success', id)}
              onError={(e) => console.error(e)}
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or pay by card</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <CardTab
            token={token}
            instanceId={process.env.NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID!}
            amount={amount}
            currency={currency}
            onSuccess={(id) => console.log('Card success', id)}
            onError={(e) => console.error(e)}
          />
        </div>
      )}

      {activeTab === 'pay-later' && (
        <BNPLTab
          methods={payLaterMethods}
          amount={amount}
          currency={currency}
          country={country}
          token={token}
          checkoutSessionId={checkoutSessionId}
          cartItems={[]} // pass your actual cart items here
        />
      )}
    </div>
  );
}
```

---

## Section 5 — BNPL UX Improvements (Kevin's Requirements)

Based on the feedback received, here is how each requirement maps to the implementation above and what still needs work from WizloPay:

| Requirement | Status | Implementation |
|---|---|---|
| "Pay over time" / financing clear to user | ✅ In code | Tab label "Pay over time" + indigo badge on each method in collapsed state |
| Tagline in collapsed row | ✅ In code | `msg.tagline` shown under method name ("Pay in 4 interest-free installments") |
| Accordion explains the option | ✅ In code | `msg.description` in expanded state replaces "you'll be redirected" |
| Short text under each method name | ✅ In code | Tagline line + "Pay over time" badge — visible without expanding |
| "As low as X/month" estimate | ✅ In code | Affirm tagline calculates from cart total |
| Klarna/Affirm messaging component | ⏳ Future | Both Klarna and Affirm provide official JS messaging widgets — see below |

**Future: Official Messaging Components**

Both Klarna and Affirm ship their own promotional messaging widgets that dynamically compute payment schedules. These are the equivalent of Stripe's `<stripe-buy-button>` messaging. These should be added next to product prices and in the checkout tab header once available from WizloPay:

- **Klarna:** [Klarna On-Site Messaging](https://docs.klarna.com/on-site-messaging/)  
- **Affirm:** [Affirm Promotional Messaging](https://docs.affirm.com/affirm-developers/docs/promotional-messaging-overview)

These widgets pull live financing terms from Klarna/Affirm's servers based on the cart amount, so they're always accurate. Kevin should raise with WizloPay whether they plan to wrap these or whether you should integrate them directly.

---

## Section 6 — Best Practices

**Security**
- `WIZLOPAY_API_KEY` is backend-only — never in the Next.js `NEXT_PUBLIC_` namespace
- Only `WIZLOPAY_INSTANCE_ID` goes to `NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID`
- Verify `verifyWebhook` on every incoming webhook before processing
- Use raw body middleware on the webhook route — JSON parsing strips whitespace and will break signature verification
- Generate JWT tokens per checkout, never cache them

**BNPL-specific**
- Write a `pending` order record before redirecting to Klarna/Affirm — the user may not return
- The `approvalUrl` for Affirm expires in 30 minutes; Klarna sessions also have short TTLs — do not store these
- On the callback route, show an optimistic state but wait for the `transaction.capture.succeeded` webhook before fulfilling the order
- Affirm: always send `cartItems` — it improves approval rates and is required by some Affirm connectors

**Webhooks**
- Return HTTP 200 before processing — do the work asynchronously (queue, background job, `setImmediate`)
- Use the `X-Gr4vy-Webhook-ID` header to deduplicate — store processed IDs in the `processed_webhooks` table
- Subscribe to at minimum: `transaction.capture.succeeded`, `transaction.capture.declined`, `transaction.capture.failed`, `buyer.created`

**Buyers**
- Always pass `buyer.externalIdentifier` (your internal user ID) at transaction creation
- Store `wizlopay_buyer_id` from the `buyer.created` webhook on your `users` table immediately
- On repeat checkouts, pass the stored WizloPay Buyer ID instead of the external identifier

---

## Section 7 — Final Checklist

- [ ] `WIZLOPAY_API_KEY`, `WIZLOPAY_INSTANCE_ID`, `WIZLOPAY_WEBHOOK_SECRET` in environment variables
- [ ] `NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID` set in Next.js env (Instance ID only — never the API key)
- [ ] NestJS `JwtService` generates tokens with correct claims (amount, currency, buyerExternalId)
- [ ] Checkout session created alongside each JWT token
- [ ] `POST /checkout/token` endpoint secured behind auth guard
- [ ] `POST /checkout/payment-options` filters into `payNow` and `payLater` groups
- [ ] Secure Fields initialized with card number, expiry, and CVV iframes
- [ ] Apple Pay domain association file served at `/.well-known/apple-developer-merchantid-domain-association`
- [ ] Apple Pay domain registered in WizloPay Dashboard
- [ ] Google Pay domain registered in WizloPay Dashboard
- [ ] Apple Pay merchant session proxied through NestJS (not called directly from browser)
- [ ] Google Pay session proxied through NestJS
- [ ] BNPL transaction creates pending DB record before redirect
- [ ] BNPL callback page shows pending state — does not confirm order
- [ ] Webhook endpoint live over HTTPS and registered in Dashboard
- [ ] Raw body middleware enabled on webhook route
- [ ] `verifyWebhook` called on every incoming webhook
- [ ] Webhook handler idempotent via `processed_webhooks` table
- [ ] `buyer.created` webhook stores WizloPay Buyer ID on user record
- [ ] PostgreSQL schema migrated with all required columns and indexes
- [ ] Full end-to-end flow tested in sandbox (card, Apple Pay, Google Pay, Klarna, Affirm)
- [ ] Declined and failed transaction paths tested
- [ ] BNPL redirect + webhook confirmed in order — not relying on callback URL status alone

---

## References

- Live docs: https://docs.wizlopay.com/guides/get-started
- Direct API overview: https://docs.wizlopay.com/guides/payments/direct-api/quick-start/overview.md
- JWT tokens: https://docs.wizlopay.com/guides/api/jwts.md
- Secure Fields: https://docs.wizlopay.com/guides/payments/secure-fields/quick-start/overview.md
- Apple Pay (no SDK): https://docs.wizlopay.com/guides/features/apple-pay/web-without-sdk.md
- Google Pay (no SDK): https://docs.wizlopay.com/guides/features/google-pay/web-without-sdk.md
- Klarna connector: https://docs.wizlopay.com/connections/payments/klarna-klarna.md
- Affirm connector: https://docs.wizlopay.com/connections/payments/affirm-affirm.md
- Webhooks: https://docs.wizlopay.com/guides/features/webhooks/overview.md
- Webhook signatures: https://docs.wizlopay.com/guides/features/webhooks/signatures.md
- Payment options API: https://docs.wizlopay.com/reference/payment-options/list-payment-options.md
