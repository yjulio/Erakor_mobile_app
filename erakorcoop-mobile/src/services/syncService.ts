import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import {
    listPendingProductSyncQueue,
    listPendingSyncQueue,
    loadSettings,
    markProductSyncAttemptFailed,
    markProductSynced,
    markSyncAttemptFailed,
    markTransactionSynced,
    replaceCustomers,
    replaceProducts,
} from './database';
import { MasterDataSyncResult, SyncResult, TransactionType } from '../types';

const SERVER_BASE_URL = 'https://erakorcoop.innovatelhubltd.com';
const BASE_RETRY_DELAY_MS = 15000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

function buildAuthHeader(token: string): string | null {
    const normalized = token.trim();
    if (!normalized) {
        return null;
    }

    if (/^Bearer\s+/i.test(normalized)) {
        return normalized;
    }

    return `Bearer ${normalized}`;
}

function requireAuthHeader(token: string): string {
    const authHeader = buildAuthHeader(token);
    if (!authHeader) {
        throw new Error('Missing bearer token. Open API Settings, enter token, and tap Save Settings.');
    }
    return authHeader;
}

export function subscribeToConnectivity(callback: (isOnline: boolean) => void): () => void {
    return NetInfo.addEventListener((state) => {
        callback(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
}

export async function syncQueuedTransactions(forceRetry = false): Promise<SyncResult> {
    const queue = await listPendingSyncQueue();
    const settings = await loadSettings();
    const authHeader = requireAuthHeader(settings.authToken);

    if (queue.length === 0) {
        return { synced: 0, failed: 0, skipped: 0 };
    }

    let synced = 0;
    let failed = 0;
    let skipped = 0;

    const endpointByType: Record<TransactionType, string> = {
        purchase: settings.purchasesEndpoint,
        sale: settings.salesEndpoint,
    };

    const api = axios.create({
        baseURL: SERVER_BASE_URL,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
    });

    for (const item of queue) {
        if (!forceRetry && item.nextRetryAt && new Date(item.nextRetryAt).getTime() > Date.now()) {
            skipped += 1;
            continue;
        }

        try {
            const payload = JSON.parse(item.payload) as Record<string, unknown>;
            const endpoint = endpointByType[item.type as TransactionType];

            await api.post(endpoint, payload);

            await markTransactionSynced(item.id, item.transactionId);
            synced += 1;
        } catch (error) {
            const nextRetryCount = item.retryCount + 1;
            const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** item.retryCount, MAX_RETRY_DELAY_MS);
            const nextRetryAt = new Date(Date.now() + delay).toISOString();
            const message = axios.isAxiosError(error)
                ? error.response?.data
                    ? JSON.stringify(error.response.data)
                    : error.message
                : 'Unknown sync error';

            await markSyncAttemptFailed(item.id, nextRetryCount, nextRetryAt, message.slice(0, 500));
            failed += 1;
        }
    }

    return { synced, failed, skipped };
}

export async function syncMasterData(): Promise<MasterDataSyncResult> {
    const settings = await loadSettings();
    const authHeader = requireAuthHeader(settings.authToken);
    const api = axios.create({
        baseURL: SERVER_BASE_URL,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
    });

    let productsResponse;
    let customersResponse;

    try {
        [productsResponse, customersResponse] = await Promise.all([
            api.get(settings.productsEndpoint),
            api.get(settings.customersEndpoint),
        ]);
    } catch (error) {
        throw new Error(formatEndpointError(error, settings.productsEndpoint, settings.customersEndpoint));
    }

    const products = normalizeProducts(productsResponse.data);
    const customers = normalizeCustomers(customersResponse.data);

    await Promise.all([replaceProducts(products), replaceCustomers(customers)]);

    return {
        products: products.length,
        customers: customers.length,
    };
}

export async function pushProductToServer(input: { name: string; unit: string; unitPrice: number }): Promise<void> {
    const settings = await loadSettings();
    const authHeader = requireAuthHeader(settings.authToken);
    const api = axios.create({
        baseURL: SERVER_BASE_URL,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
    });

    // Send multiple key aliases so we remain compatible with backend naming differences.
    const payload = {
        name: input.name,
        productName: input.name,
        unit: input.unit,
        productUnit: input.unit,
        unitPrice: input.unitPrice,
        price: input.unitPrice,
    };

    await api.post(settings.productsEndpoint, payload);
}

export async function syncQueuedProducts(): Promise<SyncResult> {
    const queue = await listPendingProductSyncQueue();
    const settings = await loadSettings();
    const authHeader = requireAuthHeader(settings.authToken);

    if (queue.length === 0) {
        return { synced: 0, failed: 0, skipped: 0 };
    }

    let synced = 0;
    let failed = 0;
    let skipped = 0;

    const api = axios.create({
        baseURL: SERVER_BASE_URL,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
    });

    for (const item of queue) {
        if (item.nextRetryAt && new Date(item.nextRetryAt).getTime() > Date.now()) {
            skipped += 1;
            continue;
        }

        try {
            const payload = JSON.parse(item.payload) as Record<string, unknown>;
            const response = await api.post(settings.productsEndpoint, payload);
            const remoteId = String((response.data as { id?: string | number; productId?: string | number })?.id ?? (response.data as { productId?: string | number })?.productId ?? '');
            await markProductSynced(item.id, item.productId, remoteId);
            synced += 1;
        } catch (error) {
            const nextRetryCount = item.retryCount + 1;
            const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** item.retryCount, MAX_RETRY_DELAY_MS);
            const nextRetryAt = new Date(Date.now() + delay).toISOString();
            const message = axios.isAxiosError(error)
                ? error.response?.data
                    ? JSON.stringify(error.response.data)
                    : error.message
                : 'Unknown product sync error';

            await markProductSyncAttemptFailed(item.id, nextRetryCount, nextRetryAt, message.slice(0, 500));
            failed += 1;
        }
    }

    return { synced, failed, skipped };
}

function formatEndpointError(error: unknown, productsEndpoint: string, customersEndpoint: string): string {
    if (!axios.isAxiosError(error)) {
        return 'Master data request failed. Please verify API settings and internet connection.';
    }

    const status = error.response?.status;
    const base = `Products endpoint: ${productsEndpoint}\nMembers endpoint: ${customersEndpoint}`;

    if (status === 401 || status === 403) {
        return `Authentication failed (${status}). Add a valid Bearer token in API Settings.\n\n${base}`;
    }

    if (status === 404) {
        return `Endpoint not found (404). Check products/members endpoint paths in API Settings.\n\n${base}`;
    }

    if (status) {
        return `Server error (${status}): ${error.message}\n\n${base}`;
    }

    return `Network error: ${error.message}\n\n${base}`;
}

function normalizeProducts(input: unknown): Array<{
    remoteId: string;
    name: string;
    unit: string;
    unitPrice: number;
    markupType: string;
    markupValue: number;
}> {
    const items = Array.isArray(input)
        ? input
        : Array.isArray((input as { data?: unknown[] })?.data)
            ? (input as { data: unknown[] }).data
            : [];

    return items
        .map((item, index) => {
            const record = item as Record<string, unknown>;
            const remoteId = String(record.id ?? record.productId ?? index + 1);
            const name = String(record.name ?? record.productName ?? record.title ?? 'Unnamed Product');
            const unit = String(record.unit ?? record.productUnit ?? record.unitLabel ?? '');
            const unitPrice = Number(record.unitPrice ?? record.price ?? record.sellingPrice ?? 0);
            const markupType = String(record.markupType ?? record.markup_type ?? '');
            const markupValue = Number(record.markupValue ?? record.markup_value ?? 0);

            return {
                remoteId,
                name,
                unit,
                unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
                markupType,
                markupValue: Number.isFinite(markupValue) ? markupValue : 0,
            };
        })
        .filter((item) => item.name.trim().length > 0);
}

function normalizeCustomers(input: unknown): Array<{
    remoteId: string;
    memberId: string;
    name: string;
    phone: string;
    joinDate: string;
}> {
    const items = Array.isArray(input)
        ? input
        : Array.isArray((input as { data?: unknown[] })?.data)
            ? (input as { data: unknown[] }).data
            : [];

    return items
        .map((item, index) => {
            const record = item as Record<string, unknown>;
            const remoteId = String(record.id ?? record.memberId ?? record.customerId ?? index + 1);
            const memberId = String(record.memberId ?? record.member_id ?? remoteId);
            const name = String(record.name ?? record.memberName ?? record.customerName ?? record.fullName ?? 'Unnamed Member');
            const phone = String(record.phone ?? record.mobile ?? '');
            const joinDate = String(record.joinDate ?? record.join_date ?? record.createdAt ?? '');

            return { remoteId, memberId, name, phone, joinDate };
        })
        .filter((item) => item.name.trim().length > 0);
}
