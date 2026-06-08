// Reads order data out of the Copilot page DOM. All knowledge of the page's
// markup (`.order-card`, `.patient-card-selected`, the `.date p` field) lives
// here; the rest of the extension works with plain order IDs and dates.

const MAX_VISIBLE_ORDERS = 5;

const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function getVisibleOrderIds(): string[] {
  const cards = document.querySelectorAll<HTMLElement>(".order-card");
  const ids: string[] = [];
  for (let i = 0; i < cards.length && ids.length < MAX_VISIBLE_ORDERS; i++) {
    if (cards[i].id) ids.push(cards[i].id);
  }
  return ids;
}

export function getSelectedOrderId(): string {
  return (
    document.querySelector(".order-card:has(.patient-card-selected)")?.id || ""
  );
}

// Date shown on the card (MM/DD/YYYY), used as the lower bound for the job
// search. Falls back to 30 days ago when the card or date can't be read.
export function getCardDate(orderId: string): Date {
  const card = document.getElementById(orderId);
  if (!card) return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  const el = card.querySelector(".date p");
  const text = (el?.textContent || "").trim();
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (parts) {
    const d = new Date(+parts[3], +parts[1] - 1, +parts[2]);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
}
