import { CheckoutShell } from '@/components/checkout/CheckoutShell';

export default function CheckoutPage() {
  const amount = 8000;
  const currency = 'USD';
  const country = 'US';

  return (
    <main className="min-h-screen bg-[#F3F4F6] flex items-start justify-center px-4 py-14">
      <div className="w-full max-w-md">

        {/* Merchant header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#6938EF] flex items-center justify-center mb-3">
            <svg width="18" height="14" viewBox="0 0 28 20" fill="none">
              <path d="M0 0h4.8l3.6 12L12 0h4l3.6 12L23.2 0H28l-6 20h-4.4L14 8l-3.6 12H6L0 0Z" fill="white"/>
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-900">Demo Store</p>
          <p className="text-xs text-gray-400 mt-0.5">1 item · Demo Product</p>
        </div>

        <CheckoutShell amount={amount} currency={currency} country={country} />

        <p className="text-center text-[11px] text-gray-400 mt-4 leading-relaxed">
          By completing this purchase you agree to our{' '}
          <span className="underline cursor-pointer">Terms</span> &{' '}
          <span className="underline cursor-pointer">Privacy Policy</span>.
        </p>
      </div>
    </main>
  );
}
