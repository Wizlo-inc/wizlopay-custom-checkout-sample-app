# WizloPay Custom Checkout — Sample Application

A production-ready reference implementation showing how to build a fully custom payment checkout with [WizloPay](https://docs.wizlo.com) — without using the hosted Embed. Built with **NestJS**, **Next.js**, and **PostgreSQL**.

---

## What this demonstrates

| Payment method | How it works |
|---|---|
| **Card** | PCI-compliant input via Secure Fields (SDK-managed iframes), card vaulted into a Checkout Session |
| **Apple Pay** | Native browser wallet, session validated server-side |
| **Google Pay** | Google Pay JS API tokenisation, token submitted via transaction API |
| **Klarna / Affirm** | BNPL redirect flow — approval opens in a new tab, buyer returns via callback URL |

The checkout UI has two tabs — **Pay now** (card + wallets) and **Pay over time** (BNPL) — and is fully self-contained, styled with Tailwind CSS.

---

## Architecture

```
┌─────────────────────────────┐       ┌─────────────────────────────┐
│     Next.js Frontend         │       │     NestJS Backend           │
│     localhost:3000           │       │     localhost:4000           │
│                              │       │                              │
│  /checkout         page      │       │  POST /checkout/token        │
│  /checkout/callback page     │──────▶│  POST /checkout/payment-options│
│                              │       │  POST /checkout/transaction  │
│  CheckoutShell               │       │  POST /checkout/bnpl         │
│  ├── CardTab (Secure Fields) │       │  POST /checkout/apple-session│
│  ├── ApplePayButton          │       │  POST /checkout/google-session│
│  ├── GooglePayButton         │       │                              │
│  └── BNPLTab                 │       │  POST /webhooks/wizlopay     │
└─────────────────────────────┘       └──────────────┬──────────────┘
                                                      │
                                         ┌────────────▼────────────┐
                                         │   PostgreSQL Database    │
                                         │   users, orders,         │
                                         │   processed_webhooks     │
                                         └─────────────────────────┘
```

Next.js rewrites all `/api/checkout/*` requests to the NestJS backend so the frontend never exposes the backend origin to the browser.

---

## Quick start

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL) or an existing PostgreSQL instance
- A WizloPay account with an Instance ID, API Key, and ES512 private key

### 1 — Clone and install

```bash
git clone <repo-url>
cd wizlopay-custom-checkout
npm install
```

### 2 — Configure the backend

```bash
cp apps/backend/.env.example apps/backend/.env
```

Edit `apps/backend/.env`:

```env
WIZLOPAY_INSTANCE_ID=your-instance-id
WIZLOPAY_API_KEY=your-api-key
WIZLOPAY_PRIVATE_KEY_ID=your-key-id
WIZLOPAY_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
WIZLOPAY_WEBHOOK_SECRET=your-webhook-secret
WIZLOPAY_ENVIRONMENT=sandbox
WIZLOPAY_MERCHANT_ACCOUNT_ID=your-merchant-account-id

APP_DOMAIN=localhost:3000
APP_PORT=4000
FRONTEND_URL=http://localhost:3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wizlopay_checkout
```

> **Private key format** — paste the full PEM block as a single line using `\n` for line breaks, or as a multiline value. The backend normalises both formats.

### 3 — Configure the frontend

```bash
cp apps/frontend/.env.local.example apps/frontend/.env.local
```

Edit `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID=your-instance-id
NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT=sandbox
BACKEND_URL=http://localhost:4000
```

### 4 — Start PostgreSQL

```bash
docker-compose up -d
```

### 5 — Start both apps

```bash
# Terminal 1 — backend
cd apps/backend && npm run start:dev

# Terminal 2 — frontend
cd apps/frontend && npm run dev
```

Open [http://localhost:3000/checkout](http://localhost:3000/checkout).

---

## Project structure

```
wizlopay-custom-checkout/
├── apps/
│   ├── backend/                   NestJS API
│   │   └── src/
│   │       ├── main.ts            Bootstrap (CORS, raw body, validation)
│   │       ├── app.module.ts      Root module
│   │       ├── payments/          Payment endpoints + gr4vy SDK integration
│   │       │   ├── jwt.service.ts         SDK client + token generation
│   │       │   ├── payments.service.ts    Business logic for all payment types
│   │       │   ├── payments.controller.ts REST endpoints
│   │       │   └── dto/                   Request validation schemas
│   │       ├── webhooks/          Webhook handler with signature verification
│   │       ├── orders/            Order entity (tracks payment status)
│   │       └── users/             User entity (stores WizloPay buyer ID)
│   │
│   └── frontend/                  Next.js App Router
│       ├── app/
│       │   ├── checkout/page.tsx          Order summary + CheckoutShell
│       │   └── checkout/callback/page.tsx Payment result page
│       ├── components/checkout/
│       │   ├── CheckoutShell.tsx  Tab switcher + data loading
│       │   ├── CardTab.tsx        Secure Fields card form
│       │   ├── ApplePayButton.tsx Apple Pay wallet button
│       │   ├── GooglePayButton.tsx Google Pay wallet button
│       │   └── BNPLTab.tsx        Klarna / Affirm accordion
│       └── public/.well-known/    Apple Pay domain verification file
│
├── docker-compose.yml             PostgreSQL for local development
└── docs/
    └── integration-guide.md       Detailed implementation walkthrough
```

---

## Payment flows

### Card (Secure Fields)

```
Browser                        Backend                    WizloPay API
   │                              │                            │
   │── POST /api/checkout/token ──▶│                            │
   │                              │── checkoutSessions.create ─▶│
   │                              │── getEmbedToken ────────────▶│
   │◀─ { token, checkoutSessionId }│                            │
   │                              │                            │
   │  [Secure Fields SDK loads]   │                            │
   │  [User types card details]   │                            │
   │  [sf.submit() vaults card]───────────────────────────────▶│
   │                              │                            │
   │── POST /api/checkout/transaction ──▶│                     │
   │   { method: 'checkout-session',     │                     │
   │     id: checkoutSessionId }         │── transactions.create▶│
   │◀─────── { transactionId } ──────────│                     │
```

The card number never touches your server. Secure Fields sends it directly to WizloPay and returns a vault confirmation event.

### Apple Pay / Google Pay

1. Frontend calls the session endpoint (`/api/checkout/apple-session` or `/api/checkout/google-session`) to get a wallet session
2. The wallet sheet is shown natively in the browser
3. The encrypted payment token from the wallet is submitted to `/api/checkout/transaction`
4. Backend creates the transaction with `method: 'applepay'` or `method: 'googlepay'`

### BNPL (Klarna / Affirm)

1. Frontend calls `/api/checkout/bnpl` with the method, amount, and a `redirectUrl`
2. Backend creates a redirect transaction — WizloPay returns an `approvalUrl`
3. Frontend opens the approval URL in a new tab
4. After buyer completes approval, they are redirected to `/checkout/callback`

---

## Environment variables reference

### Backend

| Variable | Required | Description |
|---|---|---|
| `WIZLOPAY_INSTANCE_ID` | ✅ | Your WizloPay instance ID (e.g. `acmecorp`) |
| `WIZLOPAY_API_KEY` | ✅ | Server-side API key — never expose to the browser |
| `WIZLOPAY_PRIVATE_KEY_ID` | ✅ | Key ID matching your uploaded ES512 public key |
| `WIZLOPAY_PRIVATE_KEY` | ✅ | Full ES512 PEM private key |
| `WIZLOPAY_WEBHOOK_SECRET` | ✅ | Secret for verifying webhook signatures |
| `WIZLOPAY_MERCHANT_ACCOUNT_ID` | ✅ | Merchant account ID from your dashboard |
| `WIZLOPAY_ENVIRONMENT` | ✅ | `sandbox` or `production` |
| `APP_DOMAIN` | ✅ | Domain of your frontend (used for Apple Pay) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `FRONTEND_URL` | — | Allowed CORS origin (defaults to `http://localhost:3000`) |
| `APP_PORT` | — | Backend port (defaults to `4000`) |

### Frontend

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_WIZLOPAY_INSTANCE_ID` | ✅ | Same instance ID (safe to expose — used for CDN URLs) |
| `NEXT_PUBLIC_WIZLOPAY_ENVIRONMENT` | ✅ | `sandbox` or `production` |
| `BACKEND_URL` | ✅ | Internal backend URL used by Next.js rewrites |
| `NEXT_PUBLIC_APP_DOMAIN` | — | Real domain for Google Pay (required in production) |

---

## Adapting this for your store

### Change the order details

Edit `apps/frontend/app/checkout/page.tsx`:

```tsx
const amount = 4999;    // amount in minor units (cents) — $49.99
const currency = 'USD';
const country = 'US';
```

In production, these values come from your cart or session — fetch them server-side and pass as props.

### Add a real user ID

Replace the `extractUserId` function in `payments.controller.ts` with your own auth guard:

```ts
// Current (sandbox only):
function extractUserId(authHeader?: string): string {
  if (authHeader?.startsWith('User ')) return authHeader.slice(5);
  return 'guest-' + Math.random().toString(36).slice(2, 9);
}

// Production — use a JWT guard and pull from req.user:
@UseGuards(JwtAuthGuard)
async createTransaction(@Req() req, @Body() body: CreateTransactionDto) {
  return this.paymentsService.createTransaction({ ...body, userId: req.user.id });
}
```

### Add more BNPL providers

Add a new entry in `BNPLTab.tsx` `BNPL_CONTENT` and ensure the method name matches what WizloPay returns from the payment options API.

---

## Production checklist

- [ ] Switch `WIZLOPAY_ENVIRONMENT` to `production` in both apps
- [ ] Store all secrets in a secrets manager (not in `.env` files committed to source control)
- [ ] Replace the `extractUserId` stub with a real authentication guard
- [ ] Serve the frontend over HTTPS — required for Apple Pay, Google Pay, and 3DS redirects
- [ ] Register your production domain in the WizloPay dashboard for Apple Pay and Google Pay
- [ ] Set `NEXT_PUBLIC_APP_DOMAIN` to your real domain so the Google Pay session uses the correct origin
- [ ] Point `WIZLOPAY_WEBHOOK_SECRET` to your production webhook secret and register the endpoint in the dashboard
- [ ] Add indexes on `wizlopay_transaction_id` and `wizlopay_buyer_id` in PostgreSQL
- [ ] Test a full declined-card and failed-transaction scenario — not just happy path
- [ ] Replay a webhook event twice to verify the idempotency check works

---

## Further reading

- [WizloPay integration guide](docs/integration-guide.md) — deep dive into each implementation decision
- [WizloPay API docs](https://docs.wizlo.com/guides/get-started)
