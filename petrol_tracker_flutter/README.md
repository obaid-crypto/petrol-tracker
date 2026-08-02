# DriveSense - Petrol Tracker Flutter App

This directory contains the mobile application port of DriveSense, written in Flutter. It translates the React Web application's components, calculations, and tracking systems into native mobile widgets.

## Packages Used
- `geolocator`: High-performance GPS location tracking and live speed updates.
- `shared_preferences`: Persistent local caching of petrol refuels and ride earnings.
- `intl`: Calendar date and local number formatting.

---

## Permission Configurations (Required)

Before running the app on a mobile device or emulator, you must add location permissions:

### 1. Android Configuration
Add the following lines to `<project_root>/android/app/src/main/AndroidManifest.xml` inside the `<manifest>` tag but outside the `<application>` tag:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

### 2. iOS Configuration
Add the following keys to `<project_root>/ios/Runner/Info.plist` inside the `<dict>` tag:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>DriveSense needs location access to track your ride distance and speed.</string>
<key>NSLocationAlwaysUsageDescription</key>
<string>DriveSense needs location access in the background to track your ride distance.</string>
```

---

## How to Run the App

1. Make sure you have the [Flutter SDK installed](https://docs.flutter.dev/get-started/install).
2. Connect your mobile device or start an emulator.
3. Navigate to this directory in your terminal:
   ```bash
   cd petrol_tracker_flutter
   ```
4. Fetch dependencies:
   ```bash
   flutter pub get
   ```
5. Run the application:
   ```bash
   flutter run
   ```
