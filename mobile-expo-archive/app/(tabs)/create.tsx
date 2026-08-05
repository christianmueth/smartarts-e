import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function Create() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create Artwork</Text>
      </View>

      <TouchableOpacity style={styles.imagePlaceholder}>
        <Ionicons name="cloud-upload-outline" size={48} color="#666" />
        <Text style={styles.placeholderText}>Tap to upload or take a photo</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Choose Style</Text>
        <View style={styles.styleGrid}>
          {["Realistic", "Oil", "Watercolor", "Sketch"].map((style) => (
            <TouchableOpacity key={style} style={styles.styleButton}>
              <Text style={styles.styleButtonText}>{style}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.generateButton}>
        <Text style={styles.generateButtonText}>Generate Artwork</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9f9f9",
  },
  header: {
    padding: 20,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  imagePlaceholder: {
    margin: 20,
    height: 300,
    backgroundColor: "#eee",
    borderRadius: 15,
    borderStyle: "dashed",
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    marginTop: 10,
    color: "#666",
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 15,
  },
  styleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  styleButton: {
    width: "48%",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
  },
  styleButtonText: {
    fontWeight: "500",
  },
  generateButton: {
    margin: 20,
    backgroundColor: "#000",
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  generateButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
