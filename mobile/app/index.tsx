import { Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Redirect href={isSignedIn ? "/(tabs)/create" : "/sign-in"} />;
}
