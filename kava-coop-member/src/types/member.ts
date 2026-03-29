/** Normalised row for UI — server may use snake_case; see `memberApi` mappers. */
export interface ConsumptionRecord {
  id: string;
  /** Calendar day for grouping, ISO `YYYY-MM-DD` */
  day: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  totalAmount: number | null;
  notes: string | null;
}

export interface DebtLine {
  id: string;
  description: string;
  amount: number;
  currency: string;
  asOfDate: string | null;
  reference: string | null;
}

export interface MemberDebtsView {
  totalOwed: number;
  currency: string;
  lines: DebtLine[];
}

export interface MemberProfile {
  memberId: string;
  displayName: string;
}
