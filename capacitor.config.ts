import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.muonmechatronics.smartartse",
  appName: "SmartArts-E",
  webDir: "public",
  server: {
    url: "https://smartarts-e.com",
    cleartext: false,
    androidScheme: "https",
  },
};

export default config;