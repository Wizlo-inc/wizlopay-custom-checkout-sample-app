import { CheckoutShell } from '@/components/checkout/CheckoutShell';

export default function CheckoutPage() {
  const amount = 8000;
  const currency = 'USD';
  const country = 'US';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-violet-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Order summary */}
        <div className="mb-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">Demo Product</p>
            <p className="text-xs text-gray-500 mt-0.5">Qty 1 · Ships in 2–3 days</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold text-gray-900">$80.00</p>
            <p className="text-xs text-gray-400">USD</p>
          </div>
        </div>

        <CheckoutShell amount={amount} currency={currency} country={country} />

        <p className="text-center text-xs text-gray-400 mt-5">
          By completing your purchase you agree to our{' '}
          <span className="underline cursor-pointer">Terms of Service</span>
        </p>
      </div>
    </main>
  );
}
