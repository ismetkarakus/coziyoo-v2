import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>🌿</Text>
        <Text style={styles.title}>Coziyoo</Text>
        <Text style={styles.subtitle}>Coming Soon</Text>
        <Text style={styles.description}>
          Your marketplace for fresh, local produce.
        </Text>
        
        <View style={styles.features}>
          <FeatureItem icon="🥬" text="Fresh Produce" />
          <FeatureItem icon="🚚" text="Fast Delivery" />
          <FeatureItem icon="🏪" text="Local Sellers" />
        </View>

        <TouchableOpacity style={styles.button}>
          <Text style={styles.buttonText}>Get Notified</Text>
        </TouchableOpacity>

        <Text style={styles.platform}>
          Running on {Platform.OS === 'web' ? 'Web' : Platform.OS}
        </Text>
      </View>
    </View>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8faf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
    maxWidth: 400,
  },
  logo: {
    fontSize: 80,
    marginBottom: 20,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#2d5a27',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 24,
    color: '#6b8e6b',
    marginBottom: 16,
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  features: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 40,
  },
  featureItem: {
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  featureText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#2d5a27',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 30,
    marginBottom: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  platform: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
});
