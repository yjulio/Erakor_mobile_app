import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addLocalProduct,
  addTransaction,
  countPendingSyncItems,
  initializeDatabase,
  listCustomers,
  listProducts,
  loadSettings,
  saveSettings,
  listTransactions,
} from './src/services/database';
import { pushProductToServer, subscribeToConnectivity, syncMasterData, syncQueuedProducts, syncQueuedTransactions } from './src/services/syncService';
import { AppSettings, CustomerItem, LocalTransaction, ProductItem, TransactionType } from './src/types';

export default function App() {
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>('purchase');
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    authToken: '',
    purchasesEndpoint: '/purchases',
    salesEndpoint: '/sales',
    productsEndpoint: '/products',
    customersEndpoint: '/members',
    appPin: '',
  });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshingMasterData, setIsRefreshingMasterData] = useState(false);
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showPinForm, setShowPinForm] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [updatedPin, setUpdatedPin] = useState('');
  const [confirmUpdatedPin, setConfirmUpdatedPin] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [isAddingProduct, setIsAddingProduct] = useState(false);

  const totalPreview = useMemo(() => {
    const parsedQty = Number(quantity);
    const parsedPrice = Number(unitPrice);

    if (Number.isNaN(parsedQty) || Number.isNaN(parsedPrice)) {
      return 0;
    }

    return parsedQty * parsedPrice;
  }, [quantity, unitPrice]);

  const refreshData = async () => {
    const [localTransactions, pending, localProducts, localCustomers, localSettings] = await Promise.all([
      listTransactions(),
      countPendingSyncItems(),
      listProducts(),
      listCustomers(),
      loadSettings(),
    ]);
    setTransactions(localTransactions);
    setPendingSyncCount(pending);
    setProducts(localProducts);
    setCustomers(localCustomers);
    setSettings(localSettings);
  };

  const runTransactionSync = async (showAlert = true) => {
    if (isSyncing) {
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncQueuedTransactions();
      await refreshData();

      if (showAlert && (result.synced > 0 || result.failed > 0 || result.skipped > 0)) {
        Alert.alert(
          'Transaction sync finished',
          `Synced: ${result.synced}\nFailed: ${result.failed}\nWaiting retry: ${result.skipped}`,
        );
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const runMasterDataSync = async (showAlert = true): Promise<boolean> => {
    if (isRefreshingMasterData) {
      return false;
    }

    setIsRefreshingMasterData(true);
    try {
      const result = await syncMasterData();
      await refreshData();

      if (showAlert) {
        Alert.alert('Master data synced', `Products: ${result.products}\nMembers: ${result.customers}`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error.';
      if (showAlert) {
        Alert.alert('Master data sync failed', message);
      }
      return false;
    } finally {
      setIsRefreshingMasterData(false);
    }
  };

  const runProductSync = async (showAlert = true): Promise<void> => {
    if (isSyncingProducts) {
      return;
    }

    setIsSyncingProducts(true);
    try {
      const result = await syncQueuedProducts();
      await refreshData();

      if (showAlert && (result.synced > 0 || result.failed > 0 || result.skipped > 0)) {
        Alert.alert(
          'Product sync finished',
          `Synced: ${result.synced}\nFailed: ${result.failed}\nWaiting retry: ${result.skipped}`,
        );
      }
    } finally {
      setIsSyncingProducts(false);
    }
  };

  const runFullSync = async (showAlert = true) => {
    try {
      await runProductSync(false);
    } catch {
      if (showAlert) {
        Alert.alert('Product sync failed', 'Locally added products could not be sent to server yet.');
      }
    }

    const masterDataOk = await runMasterDataSync(false);
    if (!masterDataOk && showAlert) {
      const message = 'Products/members could not be refreshed from the server.';
      Alert.alert('Master data sync failed', message);
    }

    try {
      await runTransactionSync(showAlert);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction sync failed.';
      if (showAlert) {
        Alert.alert('Transaction sync failed', message);
      }
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await initializeDatabase();
      await refreshData();
      setIsInitialized(true);
    };

    initialize().catch(() => {
      Alert.alert('Database error', 'Could not initialize local database.');
    });

    const unsubscribe = subscribeToConnectivity((online) => {
      setIsOnline(online);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    runFullSync(false).catch(() => {
      // Connectivity-triggered sync retries later.
    });
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    const intervalId = setInterval(() => {
      runProductSync(false).catch(() => {
        // Periodic product sync can fail silently.
      });
      runTransactionSync(false).catch(() => {
        // Periodic sync can fail silently; queue remains local.
      });
    }, 20000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isOnline]);

  const handleSaveSettings = async () => {
    await saveSettings(settings);
    await refreshData();
    Alert.alert('Settings saved', 'API token and endpoints were saved locally.');
  };

  const handleCreatePin = async () => {
    if (newPin.length < 4) {
      Alert.alert('PIN required', 'PIN must be at least 4 digits.');
      return;
    }

    if (!/^\d+$/.test(newPin)) {
      Alert.alert('PIN required', 'PIN can only contain numbers.');
      return;
    }

    if (newPin !== confirmNewPin) {
      Alert.alert('PIN mismatch', 'PIN and confirmation do not match.');
      return;
    }

    const updatedSettings = { ...settings, appPin: newPin };
    await saveSettings(updatedSettings);
    setSettings(updatedSettings);
    setNewPin('');
    setConfirmNewPin('');
    setIsUnlocked(true);
  };

  const handleUnlock = () => {
    if (pinInput === settings.appPin) {
      setPinInput('');
      setIsUnlocked(true);
      return;
    }

    Alert.alert('Invalid PIN', 'Please enter the correct PIN.');
  };

  const handleChangePin = async () => {
    if (currentPin !== settings.appPin) {
      Alert.alert('Invalid PIN', 'Current PIN is incorrect.');
      return;
    }

    if (updatedPin.length < 4 || !/^\d+$/.test(updatedPin)) {
      Alert.alert('PIN required', 'New PIN must be at least 4 digits and numeric only.');
      return;
    }

    if (updatedPin !== confirmUpdatedPin) {
      Alert.alert('PIN mismatch', 'New PIN and confirmation do not match.');
      return;
    }

    const nextSettings = { ...settings, appPin: updatedPin };
    await saveSettings(nextSettings);
    setSettings(nextSettings);
    setCurrentPin('');
    setUpdatedPin('');
    setConfirmUpdatedPin('');
    setShowPinForm(false);
    Alert.alert('PIN updated', 'Your app PIN has been changed.');
  };

  const handleSave = async () => {
    const parsedQty = Number(quantity);
    const parsedPrice = Number(unitPrice);

    if (!itemName.trim()) {
      Alert.alert('Validation', 'Item name is required.');
      return;
    }

    if (Number.isNaN(parsedQty) || parsedQty <= 0) {
      Alert.alert('Validation', 'Quantity must be greater than 0.');
      return;
    }

    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Validation', 'Unit price must be greater than 0.');
      return;
    }

    if (!selectedProduct) {
      Alert.alert('Validation', 'Please select a product before saving.');
      return;
    }

    const today = new Date().toDateString();
    const hasPossibleDuplicate = transactions.some((record) => {
      const sameDay = new Date(record.createdAt).toDateString() === today;
      const sameType = record.type === transactionType;
      const sameItem = record.itemName.trim().toLowerCase() === itemName.trim().toLowerCase();
      const sameQty = Number(record.quantity) === parsedQty;
      const sameUnitPrice = Number(record.unitPrice) === parsedPrice;
      return sameDay && sameType && sameItem && sameQty && sameUnitPrice;
    });

    if (hasPossibleDuplicate) {
      Alert.alert(
        'Possible duplicate',
        'A very similar record already exists today (same product, quantity and price). Adjust values if this should be a different sale.',
      );
      return;
    }

    await addTransaction({
      type: transactionType,
      itemName: itemName.trim(),
      productId: selectedProduct?.id ?? null,
      customerId: selectedCustomer?.id ?? null,
      productRemoteId: selectedProduct?.remoteId ?? null,
      customerRemoteId: selectedCustomer?.remoteId ?? null,
      memberRemoteId: selectedCustomer?.memberId ?? selectedCustomer?.remoteId ?? null,
      quantity: parsedQty,
      unitPrice: parsedPrice,
    });

    setItemName('');
    setQuantity('');
    setUnitPrice('');
    setSelectedProduct(null);
    setSelectedCustomer(null);

    await refreshData();

    if (isOnline) {
      runTransactionSync(false).catch(() => {
        // Item remains queued if sync fails.
      });
    }
  };

  const applySelectedProduct = (product: ProductItem) => {
    setSelectedProduct(product);
    setItemName(product.name);
    if (!unitPrice.trim() || Number(unitPrice) <= 0) {
      setUnitPrice(product.unitPrice.toString());
    }
    setShowProductPicker(false);
  };

  const handleAddMissingProduct = async () => {
    const normalizedName = newProductName.trim();
    const normalizedUnit = newProductUnit.trim();
    const parsedPrice = Number(newProductPrice);

    if (!normalizedName) {
      Alert.alert('Validation', 'Product name is required.');
      return;
    }

    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Validation', 'Default unit price must be greater than 0.');
      return;
    }

    if (products.some((product) => product.name.trim().toLowerCase() === normalizedName.toLowerCase())) {
      Alert.alert('Already exists', 'This product is already in the dropdown list.');
      return;
    }

    setIsAddingProduct(true);
    try {
      await addLocalProduct({
        name: normalizedName,
        unit: normalizedUnit,
        unitPrice: parsedPrice,
      });

      const updatedProducts = await listProducts();
      setProducts(updatedProducts);
      const created = updatedProducts.find((product) => product.name.trim().toLowerCase() === normalizedName.toLowerCase());
      if (created) {
        setSelectedProduct(created);
        setItemName(created.name);
        if (!unitPrice.trim() || Number(unitPrice) <= 0) {
          setUnitPrice(created.unitPrice.toString());
        }
      }
      await refreshData();
      setShowAddProductModal(false);
      setNewProductName('');
      setNewProductUnit('');
      setNewProductPrice('');

      if (isOnline) {
        try {
          await runProductSync(false);
          await runMasterDataSync(false);
          await refreshData();
          Alert.alert('Product added', 'Product was added and synced to backend.');
        } catch {
          Alert.alert('Product saved locally', 'Backend update failed. Product is available locally and will remain selectable.');
        }
      } else {
        Alert.alert('Product saved locally', 'You are offline. The product is available locally now. Sync when online.');
      }
    } finally {
      setIsAddingProduct(false);
    }
  };

  const syncButtonLabel = isSyncing ? 'Syncing...' : 'Sync Transactions';

  if (!isInitialized) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pinContainer}>
          <Text style={styles.title}>Erakor Coop Mobile</Text>
          <Text style={styles.subtitle}>Preparing app...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isUnlocked) {
    const needsPinSetup = !settings.appPin;

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.pinContainer}>
          <View style={styles.pinCard}>
            <Text style={styles.sectionTitle}>{needsPinSetup ? 'Set App PIN' : 'Enter PIN'}</Text>
            <Text style={styles.subtitle}>
              {needsPinSetup
                ? 'Create a PIN to protect the app after installation.'
                : 'Enter your PIN to continue.'}
            </Text>

            {needsPinSetup ? (
              <>
                <TextInput
                  style={styles.input}
                  value={newPin}
                  onChangeText={setNewPin}
                  placeholder="New PIN"
                  placeholderTextColor="#8f98a3"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                />
                <TextInput
                  style={styles.input}
                  value={confirmNewPin}
                  onChangeText={setConfirmNewPin}
                  placeholder="Confirm PIN"
                  placeholderTextColor="#8f98a3"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                />
                <Pressable style={styles.syncButton} onPress={handleCreatePin}>
                  <Text style={styles.syncButtonText}>Save PIN</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={pinInput}
                  onChangeText={setPinInput}
                  placeholder="Enter PIN"
                  placeholderTextColor="#8f98a3"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                />
                <Pressable style={styles.syncButton} onPress={handleUnlock}>
                  <Text style={styles.syncButtonText}>Unlock</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Image source={require('./assets/erakor-logo.png')} style={styles.heroLogo} resizeMode="contain" />
          <Text style={styles.heroEyebrow}>ERAKOR COOPERATIVE</Text>
          <Text style={styles.title}>Mobile Intake & Sales</Text>
          <Text style={styles.subtitle}>Capture transactions offline, then sync to server when online.</Text>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.pill, isOnline ? styles.onlinePill : styles.offlinePill, styles.pillLarge]}>
            <Text style={styles.pillLabel}>Connectivity</Text>
            <Text style={styles.pillText}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>
          <View style={[styles.pill, styles.pillLarge]}>
            <Text style={styles.pillLabel}>Pending</Text>
            <Text style={styles.pillText}>{pendingSyncCount}</Text>
          </View>
          <View style={[styles.pill, styles.pillLarge]}>
            <Text style={styles.pillLabel}>Products</Text>
            <Text style={styles.pillText}>{products.length}</Text>
          </View>
          <View style={[styles.pill, styles.pillLarge]}>
            <Text style={styles.pillLabel}>Members</Text>
            <Text style={styles.pillText}>{customers.length}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>API Settings</Text>
            <Pressable style={styles.linkButton} onPress={() => setShowSettings((value) => !value)}>
              <Text style={styles.linkButtonText}>{showSettings ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

          {showSettings ? (
            <>
              <TextInput
                style={styles.input}
                value={settings.authToken}
                onChangeText={(value) => setSettings((current) => ({ ...current, authToken: value }))}
                placeholder="Bearer token"
                placeholderTextColor="#8f98a3"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={settings.productsEndpoint}
                onChangeText={(value) => setSettings((current) => ({ ...current, productsEndpoint: value }))}
                placeholder="Products endpoint"
                placeholderTextColor="#8f98a3"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={settings.customersEndpoint}
                onChangeText={(value) => setSettings((current) => ({ ...current, customersEndpoint: value }))}
                placeholder="Members endpoint"
                placeholderTextColor="#8f98a3"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={settings.purchasesEndpoint}
                onChangeText={(value) => setSettings((current) => ({ ...current, purchasesEndpoint: value }))}
                placeholder="Purchases endpoint"
                placeholderTextColor="#8f98a3"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={settings.salesEndpoint}
                onChangeText={(value) => setSettings((current) => ({ ...current, salesEndpoint: value }))}
                placeholder="Sales endpoint"
                placeholderTextColor="#8f98a3"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable style={styles.secondaryButton} onPress={handleSaveSettings}>
                <Text style={styles.secondaryButtonText}>Save Settings</Text>
              </Pressable>

              <Pressable style={styles.secondaryButton} onPress={() => setShowPinForm((value) => !value)}>
                <Text style={styles.secondaryButtonText}>{showPinForm ? 'Hide PIN Form' : 'Change PIN'}</Text>
              </Pressable>

              {showPinForm ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={currentPin}
                    onChangeText={setCurrentPin}
                    placeholder="Current PIN"
                    placeholderTextColor="#8f98a3"
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                  />
                  <TextInput
                    style={styles.input}
                    value={updatedPin}
                    onChangeText={setUpdatedPin}
                    placeholder="New PIN"
                    placeholderTextColor="#8f98a3"
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                  />
                  <TextInput
                    style={styles.input}
                    value={confirmUpdatedPin}
                    onChangeText={setConfirmUpdatedPin}
                    placeholder="Confirm new PIN"
                    placeholderTextColor="#8f98a3"
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                  />
                  <Pressable style={styles.syncButton} onPress={handleChangePin}>
                    <Text style={styles.syncButtonText}>Update PIN</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}

          <View style={styles.buttonRow}>
            <Pressable style={styles.syncButton} onPress={() => runMasterDataSync(true)} disabled={isRefreshingMasterData}>
              <Text style={styles.syncButtonText}>{isRefreshingMasterData ? 'Refreshing...' : 'Refresh Products/Members'}</Text>
            </Pressable>
            <Pressable style={styles.syncButton} onPress={() => runFullSync(true)} disabled={isSyncing || isRefreshingMasterData}>
              <Text style={styles.syncButtonText}>Sync All</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>New Record</Text>

          <View style={styles.typeRow}>
            <Pressable
              style={[styles.typeButton, transactionType === 'purchase' && styles.typeButtonActive]}
              onPress={() => setTransactionType('purchase')}
            >
              <Text style={styles.typeButtonText}>Purchase</Text>
            </Pressable>
            <Pressable
              style={[styles.typeButton, transactionType === 'sale' && styles.typeButtonActive]}
              onPress={() => setTransactionType('sale')}
            >
              <Text style={styles.typeButtonText}>Sale</Text>
            </Pressable>
          </View>

          <Pressable style={styles.selector} onPress={() => setShowProductPicker(true)}>
            <Text style={styles.selectorLabel}>Product</Text>
            <Text style={styles.selectorValue}>{selectedProduct ? selectedProduct.name : 'Choose cached product'}</Text>
          </Pressable>

          {transactionType === 'sale' ? (
            <Pressable style={styles.secondaryButton} onPress={() => setShowAddProductModal(true)}>
              <Text style={styles.secondaryButtonText}>Missing product? Add to dropdown</Text>
            </Pressable>
          ) : null}

          {transactionType === 'purchase' ? (
            <Pressable style={styles.selector} onPress={() => setShowCustomerPicker(true)}>
              <Text style={styles.selectorLabel}>Member</Text>
              <Text style={styles.selectorValue}>
                {selectedCustomer
                  ? `${selectedCustomer.name} (${selectedCustomer.memberId || selectedCustomer.remoteId})`
                  : 'Choose cached member'}
              </Text>
            </Pressable>
          ) : null}

          <TextInput
            style={styles.input}
            value={itemName}
            onChangeText={setItemName}
            placeholder="Item name"
            placeholderTextColor="#8f98a3"
          />
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            placeholder="Quantity"
            keyboardType="decimal-pad"
            placeholderTextColor="#8f98a3"
          />
          <TextInput
            style={styles.input}
            value={unitPrice}
            onChangeText={setUnitPrice}
            placeholder="Unit price"
            keyboardType="decimal-pad"
            placeholderTextColor="#8f98a3"
          />

          <Text style={styles.preview}>
            {transactionType === 'sale'
              ? 'Record each sale with its own quantity and unit price.'
              : 'Record each purchase with its own quantity and unit price.'}
          </Text>
          <Text style={styles.preview}>Total: {totalPreview.toFixed(2)}</Text>

          <Pressable style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Locally</Text>
          </Pressable>

          <Pressable style={styles.syncButton} onPress={() => runTransactionSync(true)} disabled={isSyncing}>
            <Text style={styles.syncButtonText}>{syncButtonLabel}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Records</Text>
          {transactions.length === 0 ? (
            <Text style={styles.empty}>No records yet.</Text>
          ) : (
            transactions.map((record) => (
              <View key={record.id} style={styles.recordRow}>
                <View>
                  <Text style={styles.recordTitle}>
                    {record.type.toUpperCase()} - {record.itemName}
                  </Text>
                  {record.customerId ? <Text style={styles.recordMeta}>Member linked</Text> : null}
                  <Text style={styles.recordMeta}>
                    Qty {record.quantity} x {record.unitPrice.toFixed(2)}
                  </Text>
                  <Text style={styles.recordMeta}>{new Date(record.createdAt).toLocaleString()}</Text>
                </View>
                <View>
                  <Text style={styles.amount}>{record.totalAmount.toFixed(2)}</Text>
                  <Text style={[styles.syncState, record.synced ? styles.syncedText : styles.pendingText]}>
                    {record.synced ? 'Synced' : 'Pending'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <SelectionModal
        visible={showProductPicker}
        title="Select Product"
        items={products.map((product) => ({
          key: String(product.id),
          label: `${product.name}${product.unit ? ` [${product.unit}]` : ''} - ${product.unitPrice.toFixed(2)}${product.markupType ? ` (${product.markupType} ${product.markupValue})` : ''}`,
        }))}
        onClose={() => setShowProductPicker(false)}
        onSelect={(key) => {
          const match = products.find((product) => String(product.id) === key);
          if (match) {
            applySelectedProduct(match);
          }
        }}
      />

      <SelectionModal
        visible={showCustomerPicker}
        title="Select Member"
        items={customers.map((customer) => ({
          key: String(customer.id),
          label: `${customer.name}${customer.memberId ? ` (${customer.memberId})` : ''}${customer.phone ? ` - ${customer.phone}` : ''}`,
        }))}
        onClose={() => setShowCustomerPicker(false)}
        onSelect={(key) => {
          const match = customers.find((customer) => String(customer.id) === key);
          if (match) {
            setSelectedCustomer(match);
            setShowCustomerPicker(false);
          }
        }}
      />

      <Modal transparent visible={showAddProductModal} animationType="fade" onRequestClose={() => setShowAddProductModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Missing Product</Text>
            <Text style={styles.empty}>This product will appear in sale dropdown immediately.</Text>
            <TextInput
              style={styles.input}
              value={newProductName}
              onChangeText={setNewProductName}
              placeholder="Product name"
              placeholderTextColor="#8f98a3"
            />
            <TextInput
              style={styles.input}
              value={newProductUnit}
              onChangeText={setNewProductUnit}
              placeholder="Unit (e.g. kg, bunch, bag)"
              placeholderTextColor="#8f98a3"
            />
            <TextInput
              style={styles.input}
              value={newProductPrice}
              onChangeText={setNewProductPrice}
              placeholder="Default unit price"
              placeholderTextColor="#8f98a3"
              keyboardType="decimal-pad"
            />
            <Pressable style={styles.syncButton} onPress={handleAddMissingProduct} disabled={isAddingProduct || isSyncingProducts}>
              <Text style={styles.syncButtonText}>{isAddingProduct ? 'Adding...' : 'Add Product'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setShowAddProductModal(false)} disabled={isAddingProduct}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SelectionModal({
  visible,
  title,
  items,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  items: Array<{ key: string; label: string }>;
  onClose: () => void;
  onSelect: (key: string) => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={styles.modalList}>
            {items.length === 0 ? <Text style={styles.empty}>No cached items yet.</Text> : null}
            {items.map((item) => (
              <Pressable key={item.key} style={styles.modalItem} onPress={() => onSelect(item.key)}>
                <Text style={styles.modalItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f1f5fb',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  heroCard: {
    backgroundColor: '#12385f',
    borderRadius: 18,
    padding: 18,
    gap: 6,
    shadowColor: '#0a1f33',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 12,
    elevation: 6,
  },
  heroEyebrow: {
    color: '#b5d7f6',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  heroLogo: {
    width: '100%',
    height: 150,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#dce8f4',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#dfe7f1',
  },
  pillLarge: {
    minWidth: '48%',
  },
  onlinePill: {
    backgroundColor: '#d8f7e2',
  },
  offlinePill: {
    backgroundColor: '#ffe0e0',
  },
  pillLabel: {
    color: '#5f7286',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  pillText: {
    color: '#1e3550',
    fontWeight: '700',
    fontSize: 15,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    shadowColor: '#23364a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1f3349',
    marginBottom: 4,
  },
  linkButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  linkButtonText: {
    color: '#0d4e9b',
    fontWeight: '700',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonRow: {
    gap: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#eaf0f7',
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#1976d2',
  },
  typeButtonText: {
    color: '#0f2742',
    fontWeight: '700',
  },
  selector: {
    borderWidth: 1,
    borderColor: '#d8e1eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#fbfdff',
  },
  selectorLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#617489',
    marginBottom: 4,
  },
  selectorValue: {
    color: '#1d2b3a',
    fontSize: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d8e1eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    color: '#1d2b3a',
    backgroundColor: '#fbfdff',
  },
  preview: {
    fontWeight: '700',
    color: '#2d4158',
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#1e824c',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  syncButton: {
    backgroundColor: '#145ba8',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#e8eef7',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#173b66',
    fontWeight: '700',
  },
  empty: {
    color: '#66788a',
    fontStyle: 'italic',
  },
  recordRow: {
    borderWidth: 1,
    borderColor: '#ecf1f6',
    borderRadius: 12,
    padding: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordTitle: {
    fontWeight: '700',
    color: '#1f3348',
  },
  recordMeta: {
    color: '#5e7082',
    marginTop: 2,
  },
  amount: {
    textAlign: 'right',
    color: '#1d2d3f',
    fontWeight: '700',
  },
  syncState: {
    marginTop: 4,
    fontWeight: '700',
    textAlign: 'right',
  },
  syncedText: {
    color: '#1e824c',
  },
  pendingText: {
    color: '#b36400',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 37, 58, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    maxHeight: '70%',
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f3349',
  },
  modalList: {
    maxHeight: 320,
  },
  modalItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef3f8',
  },
  modalItemText: {
    color: '#1d2b3a',
  },
  pinContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  pinCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#23364a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
});
