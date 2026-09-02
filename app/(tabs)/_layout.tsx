import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { theme } from '@/constants/theme';
import {
  CollapsingTabBar,
  CollapsingTabLabel,
  TabBarCollapseProvider,
  useExpandTabBar,
} from '@/components/TabBarCollapse';

function TabLayoutInner() {
  const colorScheme = useColorScheme() ?? 'dark';
  const expandTabBar = useExpandTabBar();

  return (
    <Tabs
      tabBar={props => <CollapsingTabBar {...props} />}
      screenListeners={{
        tabPress: () => expandTabBar(),
      }}
      screenOptions={{
        sceneStyle: { backgroundColor: theme.bg },
        tabBarActiveTintColor: Colors[colorScheme].tint,
        tabBarInactiveTintColor: Colors[colorScheme].tabIconDefault,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarItemStyle: {
          alignItems: 'center',
          justifyContent: 'center',
        },
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarLabel: ({ children, color }) => (
          <CollapsingTabLabel color={String(color)}>{children}</CollapsingTabLabel>
        ),
        tabBarStyle: {
          position: 'relative',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: '100%',
          paddingTop: 0,
          paddingBottom: 0,
        },
        headerStyle: {
          backgroundColor: 'transparent',
        },
        headerTintColor: theme.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Episodes',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="tv-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: 'Movies',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="film-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <TabBarCollapseProvider>
      <TabLayoutInner />
    </TabBarCollapseProvider>
  );
}
