export type TransactionType = 'purchase' | 'sale';

export interface TransactionInput {
    type: TransactionType;
    itemName: string;
    productId?: number | null;
    customerId?: number | null;
    productRemoteId?: string | null;
    customerRemoteId?: string | null;
    memberRemoteId?: string | null;
    quantity: number;
    unitPrice: number;
}

export interface LocalTransaction {
    id: number;
    type: TransactionType;
    itemName: string;
    productId?: number | null;
    customerId?: number | null;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    createdAt: string;
    synced: number;
}

export interface SyncQueueItem {
    id: number;
    transactionId: number;
    type: TransactionType;
    payload: string;
    createdAt: string;
    retryCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
}

export interface ProductSyncQueueItem {
    id: number;
    productId: number;
    payload: string;
    createdAt: string;
    retryCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
}

export interface SyncResult {
    synced: number;
    failed: number;
    skipped: number;
}

export interface AppSettings {
    authToken: string;
    purchasesEndpoint: string;
    salesEndpoint: string;
    productsEndpoint: string;
    customersEndpoint: string;
    appPin: string;
}

export interface ProductItem {
    id: number;
    remoteId: string;
    name: string;
    unit: string;
    unitPrice: number;
    markupType: string;
    markupValue: number;
    updatedAt: string;
}

export interface CustomerItem {
    id: number;
    remoteId: string;
    memberId: string;
    name: string;
    phone: string;
    joinDate: string;
    updatedAt: string;
}

export interface MasterDataSyncResult {
    products: number;
    customers: number;
}
