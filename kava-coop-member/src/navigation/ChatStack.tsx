import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';

export type ChatStackParamList = {
  ChatList: undefined;
  ChatRoom: { conversationId: string; title: string };
};

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{ title: 'Chats', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
    </Stack.Navigator>
  );
}
