import { Stack } from "expo-router";

export default function GardenLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#fff" },
        headerTintColor: "#2D7D46",
        headerTitleStyle: { fontWeight: "600", color: "#1a1a1a" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "My Garden", headerShown: false }}
      />
      <Stack.Screen
        name="zone/[id]"
        options={{ title: "Zone" }}
      />
      <Stack.Screen
        name="plant/[id]"
        options={{ title: "Plant" }}
      />
      <Stack.Screen
        name="add-zone"
        options={{ title: "Add Zone", presentation: "modal" }}
      />
      <Stack.Screen
        name="add-plant"
        options={{ title: "Add Plant", presentation: "modal" }}
      />
      <Stack.Screen
        name="log-action"
        options={{ title: "Log Care Action", presentation: "modal" }}
      />
    </Stack>
  );
}
