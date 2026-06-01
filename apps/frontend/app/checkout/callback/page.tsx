'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

const SUCCESS_STATUSES = ['capture_succeeded', 'authorization_succeeded'];
const PENDING_STATUSES = ['buyer_approval_pending', 'authorization_pending'];

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();

  const transactionId = params.get('transaction_id');
  const status = params.get('transaction_status');

  if (!transactionId) {
    return (
      <StatusCard
        icon="error"
        title="Something went wrong"
        message="Missing transaction information. Please try again."
        action={{ label: 'Back to checkout', onClick: () => router.push('/checkout') }}
      />
    );
  }

  if (SUCCESS_STATUSES.includes(status ?? '')) {
    return (
      <StatusCard
        icon="success"
        title="Payment successful"
        message="Your payment was received. We'll send you a confirmation shortly."
        sub={`Transaction · ${transactionId.slice(0, 8).toUpperCase()}`}
      />
    );
  }

  if (PENDING_STATUSES.includes(status ?? '')) {
    return (
      <StatusCard
        icon="pending"
        title="Awaiting approval"
        message="Your financing application is being reviewed. We'll email you once confirmed."
        sub="This usually takes just a few seconds."
      />
    );
  }

  return (
    <StatusCard
      icon="error"
      title="Payment unsuccessful"
      message="Your payment could not be completed. Please try a different payment method."
      action={{ label: 'Try again', onClick: () => router.push('/checkout') }}
    />
  );
}

function StatusCard({
  icon,
  title,
  message,
  sub,
  action,
}: {
  icon: 'success' | 'pending' | 'error';
  title: string;
  message: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
}) {
  const config = {
    success: {
      ring: 'ring-green-100',
      bg: 'bg-green-50',
      icon: (
        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    pending: {
      ring: 'ring-amber-100',
      bg: 'bg-amber-50',
      icon: (
        <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    error: {
      ring: 'ring-red-100',
      bg: 'bg-red-50',
      icon: (
        <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
  }[icon];

  return (
    <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 p-8 text-center">
      <div className={`w-16 h-16 ${config.bg} ring-8 ${config.ring} rounded-full flex items-center justify-center mx-auto mb-5`}>
        {config.icon}
      </div>
      <h1 className="text-lg font-bold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-500 leading-relaxed">{message}</p>
      {sub && <p className="text-xs text-gray-400 mt-2 font-mono">{sub}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 w-full bg-[#6938EF] hover:bg-[#5526D9] text-white px-6 py-3 rounded-lg text-sm font-semibold transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function CallbackPage() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] flex items-center justify-center px-4">
      <Suspense fallback={
        <div className="w-16 h-16 rounded-full bg-gray-100 animate-pulse mx-auto" />
      }>
        <CallbackContent />
      </Suspense>
    </main>
  );
}
