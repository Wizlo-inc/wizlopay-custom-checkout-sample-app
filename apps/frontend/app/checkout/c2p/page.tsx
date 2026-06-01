import { ClickToPayScreen } from '@/components/checkout/ClickToPayScreen';

interface Props {
  searchParams: Promise<{ amount?: string; currency?: string; country?: string; buyerId?: string; email?: string }>;
}

export default async function ClickToPayPage({ searchParams }: Props) {
  const params = await searchParams;
  const amount = params.amount ? parseInt(params.amount, 10) : 8000;
  const currency = params.currency ?? 'USD';
  const country = params.country ?? 'US';
  const buyerId = params.buyerId ?? null;
  const email = params.email ?? null;

  return (
    <ClickToPayScreen
      amount={amount}
      currency={currency}
      country={country}
      buyerId={buyerId}
      email={email}
    />
  );
}
