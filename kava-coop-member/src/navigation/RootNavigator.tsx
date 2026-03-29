import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { AccountScreen } from '../screens/AccountScreen';
import { ConsumptionScreen } from '../screens/ConsumptionScreen';
import { DebtsScreen } from '../screens/DebtsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { colors } from '../theme/theme';
import { ChatStack } from './ChatStack';

export type MainTabParamList = {
  Consumption: undefined;
  Debts: undefined;
  Chats: undefined;
  Account: undefined;
};

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="Consumption"
        component={ConsumptionScreen}
        options={{
          title: 'Consumption',
          tabBarLabel: 'Consumption',
        }}
      />
      <Tabs.Screen
        name="Debts"
        component={DebtsScreen}
        options={{
          title: 'Debts',
          tabBarLabel: 'Debts',
        }}
      />
      <Tabs.Screen
        name="Chats"
        component={ChatStack}
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: 'Account',
          tabBarLabel: 'Account',
        }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { ready, token } = useAuth();

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.bootText}>Loading…</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {token ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: 12,
  },
  bootText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
});
