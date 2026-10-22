const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatPrice(value: number): string {
  return currency.format(value);
}

export function formatCompact(value: number): string {
  return compact.format(value);
}

/** Local-date ISO string (YYYY-MM-DD) — avoids UTC drift from toISOString(). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function upcomingDays(count: number): string[] {
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(base);
    day.setDate(base.getDate() + index);
    return toIsoDate(day);
  });
}

export function formatDay(iso: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T12:00:00`));
}

export function formatBookedAt(isoDateTime: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDateTime));
}

