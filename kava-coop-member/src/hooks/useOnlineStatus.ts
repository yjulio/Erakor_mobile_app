import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

function isOnlineState(state: NetInfoState | null): boolean {
  if (!state) {
    return true;
  }
  if (state.isConnected === false) {
    return false;
  }
  if (state.isInternetReachable === false) {
    return false;
  }
  return true;
}

/** True when the device appears connected to the internet (chat requires network). */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((state) => {
      if (mounted) {
        setOnline(isOnlineState(state));
      }
    });
    const unsub = NetInfo.addEventListener((state) => {
      if (mounted) {
        setOnline(isOnlineState(state));
      }
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return online;
}
