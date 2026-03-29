import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { API_ENDPOINTS, getApiBaseUrl } from '../config/server';
import type { ConsumptionRecord, DebtLine, MemberDebtsView, MemberProfile } from '../types/member';

/** Set from `AuthProvider` so expired tokens sign the user out on 401 (not on login failure). */
let sessionInvalidHandler: (() => void) | null = null;
let handling401 = false;

export function registerSessionInvalidHandler(handler: (() => void) | null): void {
  sessionInvalidHandler = handler;
}

function isLoginRequest(config: InternalAxiosRequestConfig | undefined): boolean {
  const u = config?.url ?? '';
  const loginPath = API_ENDPOINTS.login.startsWith('/')
    ? API_ENDPOINTS.login
    : `/${API_ENDPOINTS.login}`;
  return u === loginPath || u.endsWith(loginPath) || u.includes('/member/login');
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function dayFromRecord(raw: Record<string, unknown>): string {
  const d =
    str(raw.day) ||
    str(raw.date) ||
    str(raw.record_date) ||
    str(raw.transaction_date) ||
    str(raw.created_at).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    return d.slice(0, 10);
  }
  try {
    const parsed = new Date(str(raw.created_at) || str(raw.date));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  } catch {
    // fall through
  }
  return new Date().toISOString().slice(0, 10);
}

function mapConsumptionRaw(raw: Record<string, unknown>): ConsumptionRecord {
  const id =
    str(raw.id) ||
    str(raw.remote_id) ||
    `${dayFromRecord(raw)}-${str(raw.item_name || raw.itemName)}-${str(raw.created_at)}`;
  const qty = num(raw.quantity) ?? num(raw.qty) ?? 0;
  const unitPrice = num(raw.unit_price) ?? num(raw.unitPrice);
  const total =
    num(raw.total_amount) ?? num(raw.totalAmount) ?? (unitPrice != null ? unitPrice * qty : null);
  return {
    id,
    day: dayFromRecord(raw),
    itemName: str(raw.item_name || raw.itemName || raw.product_name || raw.description || 'Item'),
    quantity: qty,
    unit: str(raw.unit || raw.uom || ''),
    unitPrice,
    totalAmount: total,
    notes: (() => {
      const n = raw.notes ?? raw.note ?? raw.remarks;
      const s = str(n);
      return s || null;
    })(),
  };
}

function mapDebtRaw(raw: Record<string, unknown>): DebtLine {
  const amount =
    num(raw.amount) ??
    num(raw.balance) ??
    num(raw.total) ??
    num(raw.value) ??
    0;
  return {
    id: str(raw.id) || str(raw.reference) || `${str(raw.description)}-${amount}`,
    description: str(raw.description || raw.memo || raw.title || 'Balance'),
    amount: Math.abs(amount),
    currency: str(raw.currency || raw.currency_code || 'VTU'),
    asOfDate: (() => {
      const d = str(raw.as_of_date || raw.asOfDate || raw.date || raw.due_date);
      return d ? d.slice(0, 10) : null;
    })(),
    reference: (() => {
      const r = str(raw.reference || raw.ref || raw.invoice_id);
      return r || null;
    })(),
  };
}

function extractArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<string, unknown>[];
  }
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    const keys = ['records', 'items', 'data', 'results', 'consumption', 'lines'];
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return [];
}

export function createMemberApi(getToken: () => Promise<string | null>): AxiosInstance {
  const client = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 25_000,
  });

  client.interceptors.request.use(async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    (error) => {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        return Promise.reject(error);
      }
      if (isLoginRequest(error.config)) {
        return Promise.reject(error);
      }
      if (sessionInvalidHandler && !handling401) {
        handling401 = true;
        try {
          sessionInvalidHandler();
        } finally {
          queueMicrotask(() => {
            handling401 = false;
          });
        }
      }
      return Promise.reject(error);
    }
  );

  return client;
}

function messageFromAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ detail?: unknown; message?: string }>;
    const d = ax.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: string }).msg === 'string') {
      return (d[0] as { msg: string }).msg;
    }
    const m = ax.response?.data?.message;
    if (typeof m === 'string') return m;
    if (ax.response?.status === 401) return 'Invalid member ID or PIN.';
    if (ax.response?.status === 404) return 'Member login is not available on this server yet.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export async function postMemberLogin(
  client: AxiosInstance,
  memberId: string,
  pin: string
): Promise<{ accessToken: string; profile: MemberProfile }> {
  const path = API_ENDPOINTS.login.startsWith('/') ? API_ENDPOINTS.login : `/${API_ENDPOINTS.login}`;
  let data: Record<string, unknown>;
  try {
    const res = await client.post<Record<string, unknown>>(path, {
      member_id: memberId,
      memberId,
      pin,
    });
    data = res.data;
  } catch (e) {
    throw new Error(messageFromAxiosError(e));
  }
  const token = str(data.access_token ?? data.accessToken ?? data.token);
  if (!token) {
    throw new Error('Login response missing access token');
  }
  const profile: MemberProfile = {
    memberId: str(data.member_id || data.memberId || memberId),
    displayName: str(data.display_name || data.displayName || data.name || memberId),
  };
  return { accessToken: token, profile };
}

export async function getConsumptionRecords(
  client: AxiosInstance,
  params?: { from?: string; to?: string }
): Promise<ConsumptionRecord[]> {
  const path = API_ENDPOINTS.consumption.startsWith('/')
    ? API_ENDPOINTS.consumption
    : `/${API_ENDPOINTS.consumption}`;
  const { data } = await client.get<unknown>(path, { params });
  return extractArray(data).map((row) => mapConsumptionRaw(row));
}

export async function getMemberDebts(client: AxiosInstance): Promise<MemberDebtsView> {
  const path = API_ENDPOINTS.debts.startsWith('/') ? API_ENDPOINTS.debts : `/${API_ENDPOINTS.debts}`;
  const { data } = await client.get<unknown>(path);
  let totalOwed = 0;
  let currency = 'VTU';
  let lines: DebtLine[] = [];

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    totalOwed = num(o.total_owed) ?? num(o.totalOwed) ?? num(o.balance) ?? 0;
    currency = str(o.currency || o.currency_code || currency);
    lines = extractArray(o.lines ?? o.items ?? o.debts ?? o.records).map((row) => mapDebtRaw(row));
  } else {
    lines = extractArray(data).map((row) => mapDebtRaw(row));
    totalOwed = lines.reduce((s, l) => s + l.amount, 0);
  }

  if (totalOwed === 0 && lines.length > 0) {
    totalOwed = lines.reduce((s, l) => s + l.amount, 0);
  }

  return { totalOwed, currency, lines };
}
