# WizloPay Custom Checkout — Integration Guide

This guide explains every implementation decision in the sample application. Read it if you are adapting this code for your own store, or if you want to understand why each part is built the way it is.

---

## Table of contents

1. [Core concepts](#1-core-concepts)
2. [Backend setup](#2-backend-setup)
3. [Token generation](#3-token-generation)
4. [Checkout sessions](#4-checkout-sessions)
5. [Card payments with Secure Fields](#5-card-payments-with-secure-fields)
6. [Apple Pay](#6-apple-pay)
7. [Google Pay](#7-google-pay)
8. [BNPL — Klarna and Affirm](#8-bnpl--klarna-and-affirm)
9. [Webhooks](#9-webhooks)
10. [Database schema](#10-database-schema)
11. [Frontend architecture](#11-frontend-architecture)
12. [Security notes](#12-security-notes)

---

## 1. Core concepts

### Instance ID vs. API Key

WizloPay requires two credentials working together:

| Credential | Where used | Exposable to browser? |
|---|---|---|
| **Instance ID** | Backend SDK init, frontend CDN URLs, Secure Fields constructor | Yes — it is part of CDN URLs |
| **API Key** | Never used directly — the SDK uses the ES512 private key to self-sign JWTs | No |
| **ES512 Private Key** | Backend only — signs JWTs for both the SDK bearer token and the embed token | No — never leave the server |

The SDK never asks you to pass a raw API key in a request header. Instead it accepts a `bearerAuth` function (`withToken(...)`) that generates a signed JWT on each call.

### Amounts are in minor units

All amounts throughout the API and SDK are in the **smallest currency unit** — cents for USD, pence for GBP, etc.

```
$80.00 → 8000
£12.50 → 1250
```

This applies to every API call: token generation, checkout session creation, and transaction creation. The values must match across all three or the API will reject the request.

### The `@gr4vy/sdk` package

This sample uses the official `@gr4vy/sdk` npm package for all server-side API calls. The SDK:
- Handles JWT signing internally via the `withToken` / `bearerAuth` pattern
- Validates all inputs and outputs with Zod schemas
- Serialises camelCase TypeScript fields to the snake_case the API expects
- Adds the `x-gr4vy-merchant-account-id` header automatically on every request

---

## 2. Backend setup

### NestJS bootstrap (`main.ts`)

Three things happen at startup that are easy to get wrong:

**Raw body for webhooks.** Webhook signature verification requires the exact raw bytes that WizloPay sent — before any JSON parsing. The raw body middleware must be mounted *before* the global JSON middleware:

```ts
app.use('/webhooks/wizlopay', raw({ type: 'application/json' }));
app.use(json());
```

If you put these in the wrong order, signature verification will always fail.

**CORS.** The frontend origin must be explicitly allowed. In production replace `FRONTEND_URL` with your actual domain:

```ts
app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
```

**Validation pipe.** `whitelist: true` strips any properties not declared in the DTO, preventing unexpected fields from reaching the service layer.

### SDK initialisation (`jwt.service.ts`)

The `Gr4vy` client is initialised once at module startup in `onModuleInit`:

```ts
this.client = new Gr4vy({
  id: this.instanceId,
  server: this.environment,           // 'sandbox' | 'production'
  merchantAccountId: this.merchantAccountId,
  bearerAuth: withToken({
    privateKey: this.privateKey,
    scopes: [JWTScope.ReadAll, JWTScope.WriteAll],
  }),
});
```

`withToken` returns a function the SDK calls before each request to produce a fresh, short-lived JWT. You do not need to refresh it manually.

**Private key normalisation.** `.env` files do not support multi-line values reliably across all platforms. To handle both formats (escaped `\n` and real newlines, with or without leading indentation), the key is normalised on startup:

```ts
this.privateKey = rawValue
  .replace(/\\n/g, '\n')     // escaped \n → real newline
  .split('\n')
  .map(line => line.trim())  // strip leading spaces from each line
  .join('\n')
  .trim();
```

If the key has leading spaces on each line (common when pasting a multi-line value into a `.env` file with indentation), the PEM parser will reject it with `secretOrPrivateKey must be an asymmetric key using ES512`. This normalisation step fixes that.

---

## 3. Token generation

The frontend needs a short-lived **embed token** before it can initialise Secure Fields or any wallet payment. This token:
- Is signed with the ES512 private key
- Encodes the `amount`, `currency`, and `buyerExternalIdentifier`
- Expires quickly — if the user takes too long, you must generate a new one

```ts
// payments.service.ts
const token = await this.jwtService.generateEmbedToken({
  amount: params.amount,
  currency: params.currency,
  buyerExternalIdentifier: params.userId,
  checkoutSessionId: session.id,   // links the token to a specific checkout attempt
});
```

The frontend calls `POST /api/checkout/token` on page load and stores the token in state. It is passed to every payment component that needs it (Apple Pay, Google Pay, BNPL).

> **Do not re-use a token across page loads.** If the user navigates away and comes back, call `/api/checkout/token` again.

---

## 4. Checkout sessions

A checkout session tracks a single checkout *attempt*, which may include multiple payment tries before success. It is created at the same time as the embed token:

```ts
const session = await this.jwtService.client.checkoutSessions.create({
  amount: params.amount,
  currency: params.currency,
});
```

The session ID is returned to the frontend and used in two places:
1. **Secure Fields** — passed as `sessionId` to the Secure Fields constructor, so the vaulted card is associated with this specific checkout attempt
2. **Transaction creation** — passed as the `id` in `{ method: 'checkout-session', id: sessionId }`, telling WizloPay to charge the card already vaulted into this session

Sessions expire after **1 hour**. If the user is on the checkout page for longer than that, token generation must be repeated.

---

## 5. Card payments with Secure Fields

Secure Fields is a set of SDK-managed iframes that handle card input. The card number, expiry, and CVV never pass through your server or even through your JavaScript — they go directly from the iframe to WizloPay's vault.

### Loading the SDK

The JS and CSS must both be loaded from the CDN using your Instance ID:

```ts
const link = document.createElement('link');
link.href = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest/secure-fields.css`;

const script = document.createElement('script');
script.src = `https://cdn.${instanceId}.gr4vy.app/secure-fields/latest/secure-fields.js`;
```

Note there is no `sandbox.` or environment prefix in the CDN URL — the same CDN serves both sandbox and production.

### Initialising the fields

```ts
const sf = new SecureFields({
  gr4vyId: instanceId,
  environment,          // 'sandbox' | 'production'
  sessionId: checkoutSessionId,
});

// Each method takes a CSS selector as the first argument
sf.addCardNumberField('#sf-card-number', { placeholder: '...', styles: STYLES });
sf.addExpiryDateField('#sf-expiry',      { placeholder: 'MM / YY', styles: STYLES });
sf.addSecurityCodeField('#sf-cvv',       { placeholder: 'CVV', styles: STYLES });
```

Common mistakes:
- `addExpirationDateField` does not exist — the method is `addExpiryDateField`
- The first argument is a CSS selector string, not a DOM element
- `sf.submit()` takes no arguments — results come back via events, not a return value

### The event flow

```
READY         → fields are rendered, enable the submit button
FORM_CHANGE   → update formComplete state (data.complete === true when all fields are valid)
CARD_VAULT_SUCCESS → card is vaulted; now create the transaction
CARD_VAULT_FAILURE → show an error message to the user
```

Do not call `transactions.create` until `CARD_VAULT_SUCCESS` fires. Before that event, the card is not yet associated with the checkout session.

### Styling the iframes

The `styles` object is injected into each iframe and applied to the `<input>` element inside it. You cannot use Tailwind classes — only plain CSS property names:

```ts
const STYLES = {
  color: '#111827',
  fontSize: '15px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontWeight: '400',
  lineHeight: '1.5',
  padding: '0 12px',
  '::placeholder': { color: '#9ca3af' },
};
```

The Secure Fields SDK also injects its own stylesheet which may add borders or shadows to the host element. To prevent conflicts, wrap each host element in a separate container that owns the border:

```html
<!-- Outer wrapper: owns the border, focus ring, overflow clipping -->
<div class="secure-field-wrap">
  <!-- Host: mounted by SDK — borders stripped with !important -->
  <div id="sf-card-number" class="secure-field-host" />
</div>
```

```css
.secure-field-wrap { border: 1px solid #e5e7eb; border-radius: 12px; height: 48px; overflow: hidden; }
.secure-field-host { border: none !important; box-shadow: none !important; width: 100%; height: 100%; }
.secure-field-host iframe { display: block; width: 100%; height: 100%; border: none !important; }
.secure-field-wrap:focus-within { border-color: #7c3aed; box-shadow: 0 0 0 2px #ede9fe; }
```

---

## 6. Apple Pay

Apple Pay requires three things to work:

### Domain verification

Apple must verify that you control the domain. Place the verification file at:

```
/.well-known/apple-developer-merchantid-domain-association
```

In Next.js, put the file in `public/.well-known/` and it is served automatically. Download this file from the Apple Developer portal (Merchant Identity section) or from your WizloPay dashboard.

This must be in place before Apple Pay will show the payment sheet on your domain.

### Server-side session validation

When the user taps the Apple Pay button, Apple's servers contact your backend to validate the merchant session. The `ApplePayButton` component handles this by calling `POST /api/checkout/apple-session` with the `validationUrl` that Apple provides:

```ts
// payments.service.ts
return await this.jwtService.client.digitalWallets.sessions.applePay({
  validationUrl,
  domainName: this.config.getOrThrow('APP_DOMAIN'),
});
```

`APP_DOMAIN` must match the domain where the checkout is hosted — including subdomain, excluding `https://`.

### Transaction creation

After the user authorises in the sheet, the encrypted Apple Pay token is submitted:

```ts
paymentMethod: {
  method: 'applepay',
  token: applePayToken,       // the payment token from Apple
  cardSuffix: '...',
  cardScheme: '...',
}
```

---

## 7. Google Pay

### Domain requirement

Google Pay requires a real registered domain — `localhost` is rejected by WizloPay's `originDomain` validation. The button is hidden automatically when running on `localhost`:

```ts
const domain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? window.location.hostname;
if (domain === 'localhost' || domain === '127.0.0.1') return;
```

For local testing, use an ngrok tunnel and set `NEXT_PUBLIC_APP_DOMAIN` to the ngrok hostname.

### `isReadyToPay` check

Before calling the session endpoint or rendering the button, check whether the user's browser and saved cards support Google Pay:

```ts
const { result } = await client.isReadyToPay({
  apiVersion: 2,
  apiVersionMinor: 0,
  allowedPaymentMethods: ALLOWED_PAYMENT_METHODS,
});
if (!result) return; // hide the button silently
```

This prevents the button from appearing on browsers or devices that can't complete the payment.

### Token parsing

Google Pay returns `tokenizationData.token` as a **JSON string**. WizloPay expects a **parsed object**:

```ts
let gpToken: string | Record<string, unknown>;
try {
  gpToken = JSON.parse(paymentData.paymentMethodData.tokenizationData.token);
} catch {
  gpToken = paymentData.paymentMethodData.tokenizationData.token;
}
```

Passing the raw string will cause the transaction to fail with a validation error.

### `redirectUrl` must not be sent

Do not include `redirectUrl` in the Google Pay payment method — Google Pay handles authentication natively and does not redirect. Sending a `redirectUrl` with a localhost URL will trigger `Invalid domain name` from WizloPay's validator.

---

## 8. BNPL — Klarna and Affirm

BNPL uses the redirect payment method. Unlike card payments, there is no iframe — WizloPay creates a transaction and returns an `approvalUrl` that the buyer must visit to complete their application.

### Required fields in `paymentMethod`

The `RedirectPaymentMethodCreate` type requires `country` and `currency` **inside the `paymentMethod` object**, in addition to the top-level transaction fields:

```ts
// payments.service.ts
await this.jwtService.client.transactions.create({
  amount: params.amount,
  currency: params.currency,
  country: params.country,
  paymentMethod: {
    method: params.method,       // 'klarna' | 'affirm'
    redirectUrl: params.redirectUrl,
    country: params.country,     // required again inside paymentMethod
    currency: params.currency,   // required again inside paymentMethod
  } as any,
});
```

This duplication is a WizloPay API requirement — the `country` and `currency` inside `paymentMethod` tell the payment gateway which localisation to use for the BNPL provider's flow.

### Opening in a new tab

BNPL approval flows take time — the user fills out an application on Klarna's or Affirm's site. Opening the approval URL in a new tab preserves the checkout context in the original tab:

```ts
window.open(approvalUrl, '_blank', 'noopener,noreferrer');
```

### The redirect callback

After the buyer approves (or declines), they are redirected to your `redirectUrl`. In this sample that is `/checkout/callback`, which reads the `transaction_id` and `transaction_status` query parameters from the URL and shows the appropriate result screen.

Do not use the callback URL status as the final source of truth. Always wait for the `transaction.capture.succeeded` webhook before fulfilling an order.

### Filtering available methods

The payment options API is called server-side on page load. The response is filtered by method name:

```ts
// payments.service.ts
const payNow   = items.filter(m => ['card', 'applepay', 'googlepay'].includes(m.method));
const payLater = items.filter(m => ['klarna', 'affirm'].includes(m.method));
```

If `payLater` is empty (e.g. Klarna or Affirm is not enabled for your instance, or the order country is not supported), the "Pay over time" tab is hidden automatically.

Affirm is US-only and requires `country: 'US'` and `currency: 'USD'`.

---

## 9. Webhooks

### Why webhooks are the source of truth

The `onSuccess` callback in the frontend and the `transaction_status` URL parameter on the callback page are **optimistic signals for UI only**. They can be wrong — a card charge can appear to succeed in the immediate API response but later fail during settlement.

Webhooks are the only reliable signal. Always update order status in your database from webhook events, not from the frontend callback.

### Signature verification

Every incoming webhook must be verified before processing:

```ts
import { verifyWebhook } from '@gr4vy/sdk';

verifyWebhook(
  rawBody,                        // the exact bytes received — not JSON.parse'd
  webhookSecret,                  // from WIZLOPAY_WEBHOOK_SECRET
  signaturesHeader,               // x-gr4vy-webhook-signatures header
  timestampHeader,                // x-gr4vy-webhook-timestamp header
  300,                            // max age in seconds — reject replays older than 5 min
);
```

`rawBody` must be the raw request buffer. This is why the raw body middleware is applied *only* to the webhook route, before the JSON middleware.

### Idempotency

WizloPay may deliver the same webhook more than once (network retries, delivery guarantees). The `ProcessedWebhook` entity deduplicates by `webhookId` (the `x-gr4vy-webhook-id` header):

```ts
if (await this.processedRepo.findOne({ where: { webhookId } })) return;
await this.processedRepo.save({ webhookId });
```

Always acknowledge (return HTTP 200) immediately — before processing — so WizloPay does not retry while you are doing slow database work:

```ts
res.status(200).send('OK');
// ... then verify and process asynchronously
setImmediate(() => this.process(event).catch(...));
```

### Events handled

| Event | Action |
|---|---|
| `transaction.capture.succeeded` | Set `paymentStatus = 'paid'` on the order |
| `transaction.capture.declined` | Set `paymentStatus = 'failed'` |
| `transaction.capture.failed` | Set `paymentStatus = 'failed'` |
| `buyer.created` | Store the WizloPay buyer ID on the user record |

The `buyer.created` event arrives the first time a buyer is seen. Storing `wizlopayBuyerId` on the user allows future checkouts to pass `buyerId` instead of `buyerExternalIdentifier`, enabling saved payment methods.

---

## 10. Database schema

### `users` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Your internal user ID (used as `buyerExternalIdentifier`) |
| `email` | varchar | |
| `wizlopay_buyer_id` | varchar | Populated from `buyer.created` webhook |

### `orders` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Internal order ID |
| `user_id` | uuid | FK to users |
| `amount` | integer | In minor units |
| `currency` | varchar(3) | ISO 4217 |
| `wizlopay_transaction_id` | varchar | **Index this** — used for webhook lookups |
| `wizlopay_checkout_session_id` | varchar | Useful for correlating multiple attempts |
| `payment_status` | varchar | `pending` → `paid` or `failed` |
| `payment_method` | varchar | `card`, `klarna`, `googlepay`, etc. |

### `processed_webhooks` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Internal |
| `webhook_id` | varchar | `x-gr4vy-webhook-id` — unique, indexed |
| `created_at` | timestamp | |

---

## 11. Frontend architecture

### API proxying

The Next.js `next.config.js` rewrites all `/api/checkout/*` calls to the NestJS backend. This means:
- The browser never knows the backend origin
- CORS headers are simpler — only the Next.js origin needs to be allowed
- The backend URL is never exposed in client-side JavaScript

```js
// next.config.js
async rewrites() {
  return [
    { source: '/api/checkout/:path*', destination: `${backendUrl}/checkout/:path*` },
    { source: '/api/webhooks/:path*', destination: `${backendUrl}/webhooks/:path*` },
  ];
}
```

### Data loading in `CheckoutShell`

The shell fetches the token and payment options in parallel on mount:

```ts
Promise.all([
  fetch('/api/checkout/token', ...),
  fetch('/api/checkout/payment-options', ...),
]).then(([tokenData, optionsData]) => setCheckout({ ... }));
```

Both calls happen simultaneously to minimise time-to-interactive. If either fails, the error state is shown with a retry button.

### Component isolation

Each payment method is a self-contained component that receives `amount`, `currency`, `country`, `token`, `onSuccess`, and `onError` as props. The shell orchestrates state but does not know the implementation details of any payment method. Adding a new payment method means adding a new component and rendering it in the shell — existing components are unchanged.

---

## 12. Security notes

**Private key** — never commit this to source control and never send it to the browser. If it is exposed, rotate it immediately in the WizloPay dashboard.

**Token handoff** — the embed token is passed from backend to frontend over HTTPS. Never pass it in a URL query parameter (it would appear in server logs). This sample passes it in a JSON response body.

**Amount on the backend** — always derive the amount from your own database (cart/order), not from what the frontend sends. The frontend `amount` values in this sample are hard-coded for demonstration; in production they should come from a verified server-side cart.

**Webhook secret** — use a long random string. Rotate it if you suspect it has been compromised. The 300-second replay window (`verifyWebhook` fifth argument) prevents old requests from being replayed against your endpoint.

**Content Security Policy** — if you have a CSP, you must allow:
- `https://cdn.*.gr4vy.app` for Secure Fields scripts and styles
- `https://pay.google.com` for the Google Pay JS
- `frame-src https://*.gr4vy.app` for Secure Fields iframes
