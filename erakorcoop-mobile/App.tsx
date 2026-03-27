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
  loadDailyMarkupForProduct,
  listPendingSyncQueue,
  listCustomers,
  listProducts,
  loadSettings,
  saveDailyMarkupForProduct,
  saveSettings,
} from './src/services/database';
import { subscribeToConnectivity, syncMasterData, syncQueuedProducts, syncQueuedTransactions } from './src/services/syncService';
import { AppSettings, CustomerItem, ProductItem } from './src/types';

export default function App() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    authToken: '',
    purchasesEndpoint: '/purchases',
    salesEndpoint: '/sales',
    productsEndpoint: '/products',
    customersEndpoint: '/members',
    appPin: '',
    posPresetAmounts: '50,100,150,200,250,300',
  });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshingMasterData, setIsRefreshingMasterData] = useState(false);
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showMemberKeypad, setShowMemberKeypad] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [quickAmount, setQuickAmount] = useState<number | null>(null);
  const [quickMemberId, setQuickMemberId] = useState('');
  const [quickQuantity, setQuickQuantity] = useState('1');
  const [quickUnitPrice, setQuickUnitPrice] = useState('');
  const [quickMarkupType, setQuickMarkupType] = useState<'fixed' | 'percent'>('fixed');
  const [quickMarkupValue, setQuickMarkupValue] = useState('');
  const [syncStatusText, setSyncStatusText] = useState('No sync yet');
  const [syncStatusTone, setSyncStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const isAnySyncing = isSyncing || isRefreshingMasterData || isSyncingProducts;

  const parsedPresetAmounts = useMemo(() => {
    const values = settings.posPresetAmounts
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 9);

    if (values.length > 0) {
      return values;
    }

    return [50, 100, 150, 200, 250, 300];
  }, [settings.posPresetAmounts]);

  const refreshData = async () => {
    const [pending, localProducts, localCustomers, localSettings] = await Promise.all([
      countPendingSyncItems(),
      listProducts(),
      listCustomers(),
      loadSettings(),
    ]);
    setPendingSyncCount(pending);
    setProducts(localProducts);
    setCustomers(localCustomers);
    setSettings(localSettings);
  };

  const runTransactionSync = async (showAlert = true, forceRetry = false) => {
    if (isSyncing) {
      return;
    }

    setIsSyncing(true);
    try {
      // Keep persisted settings in sync with currently edited values before syncing.
      await saveSettings(settings);
      const result = await syncQueuedTransactions(forceRetry);
      await refreshData();

      if (showAlert && (result.synced > 0 || result.failed > 0 || result.skipped > 0)) {
        let errorDetails = '';
        if (result.failed > 0) {
          const pendingItems = await listPendingSyncQueue();
          const firstError = pendingItems.find((item) => item.lastError)?.lastError;
          if (firstError) {
            errorDetails = `\nReason: ${firstError}`;
          }
        }

        Alert.alert(
          'Transaction sync finished',
          `Synced: ${result.synced}\nFailed: ${result.failed}\nWaiting retry: ${result.skipped}${errorDetails}`,
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
      // Keep persisted settings in sync with currently edited values before syncing.
      await saveSettings(settings);
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
      // Keep persisted settings in sync with currently edited values before syncing.
      await saveSettings(settings);
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
    setSyncStatusTone('neutral');
    setSyncStatusText('Sync in progress...');

    let hasError = false;

    try {
      await runProductSync(false);
    } catch {
      hasError = true;
      if (showAlert) {
        Alert.alert('Product sync failed', 'Locally added products could not be sent to server yet.');
      }
    }

    const masterDataOk = await runMasterDataSync(false);
    if (!masterDataOk && showAlert) {
      hasError = true;
      const message = 'Products/members could not be refreshed from the server.';
      Alert.alert('Master data sync failed', message);
    }

    try {
      await runTransactionSync(showAlert);
    } catch (error) {
      hasError = true;
      const message = error instanceof Error ? error.message : 'Transaction sync failed.';
      if (showAlert) {
        Alert.alert('Transaction sync failed', message);
      }
    }

    if (hasError) {
      setSyncStatusTone('error');
      setSyncStatusText(`Last sync failed - ${new Date().toLocaleTimeString()}`);
    } else {
      setSyncStatusTone('success');
      setSyncStatusText(`Last sync successful - ${new Date().toLocaleTimeString()}`);
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

  const applySelectedProduct = (product: ProductItem) => {
    setSelectedProduct(product);
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

  const handleQuickReset = () => {
    setQuickAmount(null);
    setQuickMemberId('');
    setQuickQuantity('1');
    setQuickUnitPrice('');
    setQuickMarkupValue('');
    setQuickMarkupType('fixed');
  };

  const appendMemberDigit = (digit: string) => {
    setQuickMemberId((current) => `${current}${digit}`.slice(0, 18));
  };

  const removeLastMemberDigit = () => {
    setQuickMemberId((current) => current.slice(0, -1));
  };

  const handleSelectQuickAmount = (amount: number) => {
    setQuickAmount(amount);
    setQuickUnitPrice(amount.toString());
    if (!quickMemberId.trim()) {
      setShowMemberKeypad(true);
    }
  };

  const getTodayDateKey = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const calculateUnitPriceFromMarkup = (basePrice: number, type: 'fixed' | 'percent', rawValue: string) => {
    const markupValue = Number(rawValue || 0);
    if (Number.isNaN(markupValue)) {
      return basePrice;
    }

    if (type === 'percent') {
      return Math.max(0, basePrice + (basePrice * markupValue) / 100);
    }

    return Math.max(0, basePrice + markupValue);
  };

  const handleQuickBuy = async () => {
    if (!selectedProduct) {
      Alert.alert('Select product', 'Choose a product first for quick POS sale.');
      return;
    }

    const parsedQty = Number(quickQuantity);
    const parsedUnitPrice = Number(quickUnitPrice || quickAmount || 0);

    if (Number.isNaN(parsedQty) || parsedQty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a quantity greater than 0.');
      return;
    }

    if (Number.isNaN(parsedUnitPrice) || parsedUnitPrice <= 0) {
      Alert.alert('Invalid price', 'Enter a unit price greater than 0.');
      return;
    }

    const normalizedMemberId = quickMemberId.trim().toLowerCase();
    const matchedCustomer = normalizedMemberId
      ? customers.find(
          (customer) =>
            customer.memberId.trim().toLowerCase() === normalizedMemberId ||
            customer.remoteId.trim().toLowerCase() === normalizedMemberId,
        ) ?? null
      : null;

    await saveDailyMarkupForProduct(
      selectedProduct.id,
      getTodayDateKey(),
      quickMarkupType,
      Number(quickMarkupValue || 0),
    );

    await addTransaction({
      type: 'sale',
      itemName: selectedProduct.name,
      productId: selectedProduct.id,
      customerId: matchedCustomer?.id ?? null,
      productRemoteId: selectedProduct.remoteId,
      customerRemoteId: matchedCustomer?.remoteId ?? null,
      memberRemoteId: matchedCustomer?.memberId ?? matchedCustomer?.remoteId ?? null,
      quantity: parsedQty,
      unitPrice: parsedUnitPrice,
    });

    await refreshData();
    handleQuickReset();

    if (isOnline) {
      runTransactionSync(false).catch(() => {
        // Item remains queued if sync fails.
      });
    }

    Alert.alert('Saved', 'Quick sale saved locally.');
  };

  const handleApplyTodayMarkup = async () => {
    if (!selectedProduct) {
      Alert.alert('Select product', 'Choose a product first.');
      return;
    }

    const parsedMarkupValue = Number(quickMarkupValue || 0);
    if (Number.isNaN(parsedMarkupValue)) {
      Alert.alert('Invalid markup', 'Enter a valid markup number.');
      return;
    }

    await saveDailyMarkupForProduct(selectedProduct.id, getTodayDateKey(), quickMarkupType, parsedMarkupValue);
    const priceWithMarkup = calculateUnitPriceFromMarkup(selectedProduct.unitPrice, quickMarkupType, quickMarkupValue);
    setQuickUnitPrice(priceWithMarkup.toFixed(2));
    Alert.alert('Markup saved', 'Today markup saved for this product.');
  };

  useEffect(() => {
    const loadTodayMarkup = async () => {
      if (!selectedProduct) {
        return;
      }

      const saved = await loadDailyMarkupForProduct(selectedProduct.id, getTodayDateKey());
      if (saved) {
        const resolvedType: 'fixed' | 'percent' = saved.markupType === 'percent' ? 'percent' : 'fixed';
        setQuickMarkupType(resolvedType);
        setQuickMarkupValue(String(saved.markupValue));
        const priceWithMarkup = calculateUnitPriceFromMarkup(selectedProduct.unitPrice, resolvedType, String(saved.markupValue));
        setQuickUnitPrice(priceWithMarkup.toFixed(2));
        return;
      }

      const fallbackType: 'fixed' | 'percent' = selectedProduct.markupType?.toLowerCase() === 'percent' ? 'percent' : 'fixed';
      setQuickMarkupType(fallbackType);
      setQuickMarkupValue(String(selectedProduct.markupValue ?? 0));
      const priceWithMarkup = calculateUnitPriceFromMarkup(selectedProduct.unitPrice, fallbackType, String(selectedProduct.markupValue ?? 0));
      setQuickUnitPrice(priceWithMarkup.toFixed(2));
    };

    loadTodayMarkup().catch(() => {
      // Keep manual pricing if markup load fails.
    });
  }, [selectedProduct]);

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

        <View style={styles.posCard}>
          <View style={styles.posHeaderRow}>
            <Text style={styles.posTitle}>POS</Text>
          </View>

          <Pressable style={styles.selector} onPress={() => setShowProductPicker(true)}>
            <Text style={styles.selectorLabel}>Sale Product</Text>
            <Text style={styles.selectorValue}>{selectedProduct ? selectedProduct.name : 'Choose product for POS'}</Text>
          </Pressable>

          <View style={styles.posActionRow}>
            <Pressable style={[styles.secondaryButton, styles.markupSaveButton]} onPress={() => setShowAddProductModal(true)}>
              <Text style={styles.secondaryButtonText}>Add New Product</Text>
            </Pressable>
            <Pressable style={[styles.syncButton, styles.markupSaveButton]} onPress={() => runFullSync(true)}>
              <Text style={styles.syncButtonText}>Sync Data</Text>
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.syncStatusBar,
              syncStatusTone === 'success' && styles.syncStatusBarSuccess,
              syncStatusTone === 'error' && styles.syncStatusBarError,
            ]}
            onPress={() => runFullSync(true)}
            disabled={isAnySyncing}
          >
            <Text style={styles.syncStatusText}>{syncStatusText}</Text>
            <Text style={styles.syncStatusHint}>{isAnySyncing ? 'Syncing now...' : 'Tap to retry sync'}</Text>
          </Pressable>

          <View style={styles.posResultBox}>
            <Text style={styles.posResultTitle}>Results</Text>
            <Text style={styles.posResultMain}>
              {(Number(quickQuantity || 0) * Number(quickUnitPrice || quickAmount || 0) || 0).toFixed(0)}VT
            </Text>
            <Text style={styles.posResultText}>Member: {quickMemberId.trim() || '-'}</Text>
          </View>

          <View style={styles.amountGrid}>
            {parsedPresetAmounts.map((amount, index) => {
              const colors = ['#ff5b2a', '#f39c12', '#f7c500', '#efe145', '#c8da3b', '#8bc34a'];
              const isActive = quickAmount === amount;
              return (
                <Pressable
                  key={amount}
                  style={[styles.amountButton, { backgroundColor: colors[index] }, isActive && styles.amountButtonActive]}
                  onPress={() => handleSelectQuickAmount(amount)}
                >
                  <Text style={styles.amountButtonText}>{amount}VT</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.posActionRow}>
            <Pressable
              style={[styles.typeButton, quickMarkupType === 'fixed' && styles.typeButtonActive]}
              onPress={() => setQuickMarkupType('fixed')}
            >
              <Text style={styles.typeButtonText}>Fixed Markup</Text>
            </Pressable>
            <Pressable
              style={[styles.typeButton, quickMarkupType === 'percent' && styles.typeButtonActive]}
              onPress={() => setQuickMarkupType('percent')}
            >
              <Text style={styles.typeButtonText}>% Markup</Text>
            </Pressable>
          </View>

          <View style={styles.posActionRow}>
            <TextInput
              style={[styles.input, styles.posMiniInput]}
              value={quickMarkupValue}
              onChangeText={setQuickMarkupValue}
              placeholder={quickMarkupType === 'percent' ? 'Markup %' : 'Markup amount'}
              placeholderTextColor="#8f98a3"
              keyboardType="decimal-pad"
            />
            <Pressable style={[styles.secondaryButton, styles.markupSaveButton]} onPress={handleApplyTodayMarkup}>
              <Text style={styles.secondaryButtonText}>Save Today Markup</Text>
            </Pressable>
          </View>

          <View style={styles.posActionRow}>
            <TextInput
              style={[styles.input, styles.posMiniInput]}
              value={quickQuantity}
              onChangeText={setQuickQuantity}
              placeholder="Qty"
              placeholderTextColor="#8f98a3"
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.posMiniInput]}
              value={quickUnitPrice}
              onChangeText={setQuickUnitPrice}
              placeholder="Unit price"
              placeholderTextColor="#8f98a3"
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.posActionRow}>
            <Pressable style={[styles.input, styles.memberIdInput]} onPress={() => setShowMemberKeypad(true)}>
              <Text style={styles.memberIdValue}>{quickMemberId || 'Tap to enter Member ID'}</Text>
            </Pressable>
            <Pressable style={styles.memberPadButton} onPress={() => setShowMemberKeypad(true)}>
              <Text style={styles.memberPadButtonText}>KEYPAD</Text>
            </Pressable>
          </View>

          <View style={styles.posActionRow}>
            <Pressable style={[styles.syncButton, styles.buyButton]} onPress={handleQuickBuy}>
              <Text style={styles.syncButtonText}>BUY</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, styles.resetButton]} onPress={handleQuickReset}>
              <Text style={styles.secondaryButtonText}>RESET</Text>
            </Pressable>
          </View>
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

      <Modal visible={showMemberKeypad} animationType="slide" onRequestClose={() => setShowMemberKeypad(false)}>
        <SafeAreaView style={styles.keypadScreen}>
          <View style={styles.keypadHeader}>
            <Text style={styles.keypadHeaderTitle}>Enter Member ID</Text>
            <Text style={styles.keypadMemberValue}>{quickMemberId || '-'}</Text>
          </View>

          <View style={styles.keypadScreenGrid}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <Pressable key={digit} style={styles.keypadScreenButton} onPress={() => appendMemberDigit(digit)}>
                <Text style={styles.keypadScreenText}>{digit}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.keypadScreenButton, styles.keypadScreenAction]} onPress={removeLastMemberDigit}>
              <Text style={styles.keypadScreenText}>DEL</Text>
            </Pressable>
            <Pressable style={styles.keypadScreenButton} onPress={() => appendMemberDigit('0')}>
              <Text style={styles.keypadScreenText}>0</Text>
            </Pressable>
            <Pressable style={[styles.keypadScreenButton, styles.keypadScreenAction]} onPress={() => setQuickMemberId('')}>
              <Text style={styles.keypadScreenText}>CLR</Text>
            </Pressable>
          </View>

          <View style={styles.keypadFooter}>
            <Pressable style={[styles.secondaryButton, styles.keypadFooterButton]} onPress={() => setShowMemberKeypad(false)}>
              <Text style={styles.secondaryButtonText}>Done</Text>
            </Pressable>
          </View>
        </SafeAreaView>
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
  posCard: {
    backgroundColor: '#667a42',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  posHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  posToggleButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  posToggleText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  posTitle: {
    fontSize: 32,
    letterSpacing: 4,
    color: '#e7efdc',
    fontWeight: '700',
  },
  posResultBox: {
    borderWidth: 2,
    borderColor: '#cfd6c4',
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  posResultTitle: {
    textAlign: 'center',
    color: '#f0f5ea',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 2,
  },
  posResultText: {
    color: '#eef5e7',
    fontSize: 18,
    fontWeight: '700',
  },
  posResultMain: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 1,
  },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  amountButton: {
    width: '32%',
    borderRadius: 14,
    paddingVertical: 24,
    alignItems: 'center',
  },
  amountButtonActive: {
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  amountButtonText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
  },
  posActionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  memberIdInput: {
    flex: 1,
    backgroundColor: '#41444d',
    justifyContent: 'center',
    borderColor: '#5e6168',
  },
  posMiniInput: {
    flex: 1,
    backgroundColor: '#f6f9f3',
  },
  markupSaveButton: {
    flex: 1,
    justifyContent: 'center',
  },
  memberIdValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  memberPadButton: {
    backgroundColor: '#2f453a',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberPadButtonText: {
    color: '#e8f3ea',
    fontSize: 14,
    fontWeight: '800',
  },
  syncStatusBar: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  syncStatusBarSuccess: {
    backgroundColor: 'rgba(30,130,76,0.35)',
  },
  syncStatusBarError: {
    backgroundColor: 'rgba(179,100,0,0.35)',
  },
  syncStatusText: {
    color: '#f2f8ea',
    fontWeight: '700',
    fontSize: 12,
  },
  syncStatusHint: {
    color: '#dce9d7',
    marginTop: 2,
    fontSize: 11,
  },
  buyButton: {
    flex: 1,
    backgroundColor: '#4caf50',
    justifyContent: 'center',
  },
  resetButton: {
    flex: 1,
    backgroundColor: '#afb2aa',
    justifyContent: 'center',
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
  keypadScreen: {
    flex: 1,
    backgroundColor: '#1f3b1d',
    padding: 16,
    gap: 14,
  },
  keypadHeader: {
    backgroundColor: '#2f4f2b',
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  keypadHeaderTitle: {
    color: '#d5e7d2',
    fontSize: 16,
    fontWeight: '700',
  },
  keypadMemberValue: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1,
  },
  keypadScreenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  keypadScreenButton: {
    width: '31%',
    backgroundColor: '#4f6a35',
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: 'center',
  },
  keypadScreenAction: {
    backgroundColor: '#3e5131',
  },
  keypadScreenText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
  },
  keypadFooter: {
    marginTop: 'auto',
  },
  keypadFooterButton: {
    paddingVertical: 14,
  },
});
