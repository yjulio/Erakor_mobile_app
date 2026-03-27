import * as SQLite from 'expo-sqlite';
import {
    AppSettings,
    CustomerItem,
    LocalTransaction,
    ProductSyncQueueItem,
    ProductItem,
    SyncQueueItem,
    TransactionInput,
} from '../types';

const dbPromise = SQLite.openDatabaseAsync('erakorcoop_offline.db');

const defaultSettings: AppSettings = {
    authToken: '',
    purchasesEndpoint: '/purchases',
    salesEndpoint: '/sales',
    productsEndpoint: '/products',
    customersEndpoint: '/members',
    appPin: '',
};

const legacyEndpointMap: Partial<AppSettings> = {
    purchasesEndpoint: '/api/mobile/purchases',
    salesEndpoint: '/api/mobile/sales',
    productsEndpoint: '/api/mobile/products',
    customersEndpoint: '/api/mobile/members',
};

export async function initializeDatabase(): Promise<void> {
    const db = await dbPromise;

    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('purchase', 'sale')),
      item_name TEXT NOT NULL,
      product_id INTEGER,
      customer_id INTEGER,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
            unit TEXT NOT NULL DEFAULT '',
      unit_price REAL NOT NULL DEFAULT 0,
            markup_type TEXT NOT NULL DEFAULT '',
            markup_value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id TEXT NOT NULL UNIQUE,
            member_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            join_date TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
        );
  `);

    await ensureColumn('transactions', 'product_id', 'INTEGER');
    await ensureColumn('transactions', 'customer_id', 'INTEGER');
    await ensureColumn('sync_queue', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('sync_queue', 'next_retry_at', 'TEXT');
    await ensureColumn('sync_queue', 'last_error', 'TEXT');
    await ensureColumn('product_sync_queue', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('product_sync_queue', 'next_retry_at', 'TEXT');
    await ensureColumn('product_sync_queue', 'last_error', 'TEXT');
    await ensureColumn('products', 'unit', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('products', 'markup_type', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('products', 'markup_value', 'REAL NOT NULL DEFAULT 0');
    await ensureColumn('customers', 'member_id', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('customers', 'phone', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('customers', 'join_date', "TEXT NOT NULL DEFAULT ''");

    await ensureDefaultSettings();
}

export async function addTransaction(input: TransactionInput): Promise<void> {
    const db = await dbPromise;
    const createdAt = new Date().toISOString();
    const totalAmount = input.quantity * input.unitPrice;

    const insertResult = await db.runAsync(
        `INSERT INTO transactions (type, item_name, product_id, customer_id, quantity, unit_price, total_amount, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
            input.type,
            input.itemName,
            input.productId ?? null,
            input.customerId ?? null,
            input.quantity,
            input.unitPrice,
            totalAmount,
            createdAt,
        ],
    );

    const payload = JSON.stringify({
        type: input.type,
        itemName: input.itemName,
        productId: input.productId ?? null,
        customerId: input.customerId ?? null,
        productRemoteId: input.productRemoteId ?? null,
        customerRemoteId: input.customerRemoteId ?? null,
        memberRemoteId: input.memberRemoteId ?? null,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        totalAmount,
        createdAt,
    });

    await db.runAsync(
        `INSERT INTO sync_queue (transaction_id, type, payload, created_at)
     VALUES (?, ?, ?, ?)`,
        [insertResult.lastInsertRowId, input.type, payload, createdAt],
    );
}

export async function listTransactions(): Promise<LocalTransaction[]> {
    const db = await dbPromise;
    const rows = await db.getAllAsync<{
        id: number;
        type: 'purchase' | 'sale';
        item_name: string;
        product_id: number | null;
        customer_id: number | null;
        quantity: number;
        unit_price: number;
        total_amount: number;
        created_at: string;
        synced: number;
    }>('SELECT * FROM transactions ORDER BY created_at DESC');

    return rows.map((row) => ({
        id: row.id,
        type: row.type,
        itemName: row.item_name,
        productId: row.product_id,
        customerId: row.customer_id,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        totalAmount: row.total_amount,
        createdAt: row.created_at,
        synced: row.synced,
    }));
}

export async function listPendingSyncQueue(): Promise<SyncQueueItem[]> {
    const db = await dbPromise;
    return db.getAllAsync<SyncQueueItem>(
        `SELECT
      id,
      transaction_id as transactionId,
      type,
      payload,
      created_at as createdAt,
      retry_count as retryCount,
      next_retry_at as nextRetryAt,
      last_error as lastError
    FROM sync_queue
    ORDER BY id ASC`,
    );
}

export async function markTransactionSynced(queueId: number, transactionId: number): Promise<void> {
    const db = await dbPromise;
    await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE transactions SET synced = 1 WHERE id = ?', [transactionId]);
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [queueId]);
    });
}

export async function markSyncAttemptFailed(queueId: number, retryCount: number, nextRetryAt: string, error: string): Promise<void> {
    const db = await dbPromise;
    await db.runAsync(
        'UPDATE sync_queue SET retry_count = ?, next_retry_at = ?, last_error = ? WHERE id = ?',
        [retryCount, nextRetryAt, error, queueId],
    );
}

export async function countPendingSyncItems(): Promise<number> {
    const db = await dbPromise;
    const row = await db.getFirstAsync<{ pending: number }>('SELECT COUNT(*) as pending FROM sync_queue');
    return row?.pending ?? 0;
}

export async function loadSettings(): Promise<AppSettings> {
    const db = await dbPromise;
    const rows = await db.getAllAsync<{ key: keyof AppSettings; value: string }>('SELECT key, value FROM settings');

    const settings = { ...defaultSettings };

    for (const row of rows) {
        settings[row.key] = row.value;
    }

    return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
    const db = await dbPromise;

    await db.withTransactionAsync(async () => {
        for (const [key, value] of Object.entries(settings)) {
            await db.runAsync(
                `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [key, value],
            );
        }
    });
}

export async function listProducts(): Promise<ProductItem[]> {
    const db = await dbPromise;
    return db.getAllAsync<ProductItem>(
        `SELECT
            id,
            remote_id as remoteId,
            name,
            unit,
            unit_price as unitPrice,
            markup_type as markupType,
            markup_value as markupValue,
            updated_at as updatedAt
        FROM products
        ORDER BY name ASC`,
    );
}

export async function addLocalProduct(input: { name: string; unit: string; unitPrice: number }): Promise<void> {
    const db = await dbPromise;
    const updatedAt = new Date().toISOString();
    const remoteId = `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.withTransactionAsync(async () => {
        const insertResult = await db.runAsync(
            'INSERT INTO products (remote_id, name, unit, unit_price, markup_type, markup_value, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [remoteId, input.name.trim(), input.unit.trim(), input.unitPrice, '', 0, updatedAt],
        );

        const payload = JSON.stringify({
            name: input.name.trim(),
            productName: input.name.trim(),
            unit: input.unit.trim(),
            productUnit: input.unit.trim(),
            unitPrice: input.unitPrice,
            price: input.unitPrice,
        });

        await db.runAsync(
            `INSERT INTO product_sync_queue (product_id, payload, created_at)
             VALUES (?, ?, ?)`,
            [insertResult.lastInsertRowId, payload, updatedAt],
        );
    });
}

export async function listPendingProductSyncQueue(): Promise<ProductSyncQueueItem[]> {
    const db = await dbPromise;
    return db.getAllAsync<ProductSyncQueueItem>(
        `SELECT
            id,
            product_id as productId,
            payload,
            created_at as createdAt,
            retry_count as retryCount,
            next_retry_at as nextRetryAt,
            last_error as lastError
        FROM product_sync_queue
        ORDER BY id ASC`,
    );
}

export async function markProductSynced(queueId: number, productId: number, remoteId?: string): Promise<void> {
    const db = await dbPromise;
    await db.withTransactionAsync(async () => {
        if (remoteId && remoteId.trim().length > 0) {
            await db.runAsync('UPDATE products SET remote_id = ?, updated_at = ? WHERE id = ?', [remoteId, new Date().toISOString(), productId]);
        }
        await db.runAsync('DELETE FROM product_sync_queue WHERE id = ?', [queueId]);
    });
}

export async function markProductSyncAttemptFailed(queueId: number, retryCount: number, nextRetryAt: string, error: string): Promise<void> {
    const db = await dbPromise;
    await db.runAsync(
        'UPDATE product_sync_queue SET retry_count = ?, next_retry_at = ?, last_error = ? WHERE id = ?',
        [retryCount, nextRetryAt, error, queueId],
    );
}

export async function listCustomers(): Promise<CustomerItem[]> {
    const db = await dbPromise;
    return db.getAllAsync<CustomerItem>(
        `SELECT
            id,
            remote_id as remoteId,
            member_id as memberId,
            name,
            phone,
            join_date as joinDate,
            updated_at as updatedAt
        FROM customers
        ORDER BY name ASC`,
    );
}

export async function replaceProducts(items: Array<{
    remoteId: string;
    name: string;
    unit: string;
    unitPrice: number;
    markupType: string;
    markupValue: number;
}>): Promise<void> {
    const db = await dbPromise;
    const updatedAt = new Date().toISOString();

    await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM products');
        for (const item of items) {
            await db.runAsync(
                'INSERT INTO products (remote_id, name, unit, unit_price, markup_type, markup_value, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [item.remoteId, item.name, item.unit, item.unitPrice, item.markupType, item.markupValue, updatedAt],
            );
        }
    });
}

export async function replaceCustomers(items: Array<{ remoteId: string; memberId: string; name: string; phone: string; joinDate: string }>): Promise<void> {
    const db = await dbPromise;
    const updatedAt = new Date().toISOString();

    await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM customers');
        for (const item of items) {
            await db.runAsync(
                'INSERT INTO customers (remote_id, member_id, name, phone, join_date, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                [item.remoteId, item.memberId, item.name, item.phone, item.joinDate, updatedAt],
            );
        }
    });
}

async function ensureDefaultSettings(): Promise<void> {
    const existing = await loadSettings();
    const normalized: AppSettings = { ...defaultSettings, ...existing };

    // Migrate old endpoint defaults to the current server routes.
    for (const key of Object.keys(legacyEndpointMap) as Array<keyof AppSettings>) {
        if (normalized[key] === legacyEndpointMap[key]) {
            normalized[key] = defaultSettings[key];
        }
    }

    await saveSettings(normalized);
}

async function ensureColumn(tableName: string, columnName: string, definition: string): Promise<void> {
    const db = await dbPromise;
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const exists = columns.some((column) => column.name === columnName);

    if (!exists) {
        await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
}
