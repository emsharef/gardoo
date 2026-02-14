import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "../lib/trpc";
import { useAuthStore } from "../lib/auth-store";

export default function RegisterScreen() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data) => {
      await setToken(data.token);
    },
    onError: (err) => {
      setError(err.message || "Registration failed");
    },
  });

  const handleRegister = () => {
    setError(null);

    if (!email || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    registerMutation.mutate({ email, password });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Gardoo</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Password (min 8 characters)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TextInput
          style={styles.input}
          placeholder="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, registerMutation.isPending && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Register</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.link}
          onPress={() => router.replace("/(auth)/login")}
        >
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkBold}>Login</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  form: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
    color: "#2d6a4f",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    color: "#666",
  },
  error: {
    color: "#d32f2f",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: "#fafafa",
  },
  button: {
    backgroundColor: "#2d6a4f",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  link: {
    marginTop: 24,
    alignItems: "center",
  },
  linkText: {
    color: "#666",
    fontSize: 14,
  },
  linkBold: {
    color: "#2d6a4f",
    fontWeight: "600",
  },
});
