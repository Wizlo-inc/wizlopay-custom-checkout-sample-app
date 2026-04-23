import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">WizloPay Custom Checkout</h1>
        <p className="text-gray-500">Sandbox demo — two-tab checkout with card, wallets, and BNPL</p>
        <Link
          href="/checkout"
          className="inline-block bg-black text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Demo checkout — $49.99
        </Link>
      </div>
    </main>
  );
}
