import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:intl/intl.dart';

class MILEAGE_CONFIG {
  static const double MIN_DISTANCE_THRESHOLD = 20.0;
  static const int ROLLING_WINDOW = 5;
}

void main() {
  runApp(const PetrolTrackerApp());
}

class PetrolTrackerApp extends StatelessWidget {
  const PetrolTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DriveSense - Petrol Tracker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0C1321),
        primaryColor: const Color(0xFF6DE9BE),
        fontFamily: 'Manrope',
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF6DE9BE),
          secondary: Color(0xFFB9C3FF),
          tertiary: Color(0xFFFFC8A1),
          surface: Color(0xFF19202E),
          error: Color(0xFFFFB4AB),
        ),
      ),
      home: const MainLayoutScreen(),
    );
  }
}

// ==========================================
// DATA MODELS
// ==========================================

class PetrolEntry {
  final int id;
  final double litres;
  final double pricePerLitre;
  final double totalCost;
  final String date;
  final double kmTraveled;
  final double mileage;
  final bool isEstimated;
  final String createdAt;

  PetrolEntry({
    required this.id,
    required this.litres,
    required this.pricePerLitre,
    required this.totalCost,
    required this.date,
    required this.kmTraveled,
    required this.mileage,
    required this.isEstimated,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'litres': litres,
        'pricePerLitre': pricePerLitre,
        'totalCost': totalCost,
        'date': date,
        'kmTraveled': kmTraveled,
        'mileage': mileage,
        'isEstimated': isEstimated,
        'createdAt': createdAt,
      };

  factory PetrolEntry.fromJson(Map<String, dynamic> json) => PetrolEntry(
        id: json['id'],
        litres: (json['litres'] as num).toDouble(),
        pricePerLitre: (json['pricePerLitre'] as num).toDouble(),
        totalCost: (json['totalCost'] as num).toDouble(),
        date: json['date'],
        kmTraveled: (json['kmTraveled'] as num).toDouble(),
        mileage: (json['mileage'] as num).toDouble(),
        isEstimated: json['isEstimated'] ?? false,
        createdAt: json['createdAt'] ?? '',
      );
}

class Trip {
  final int id;
  final String startTime;
  final String endTime;
  final double distance;
  final bool isActive;
  final bool isRide;
  final double earnings;
  final bool isManual;

  Trip({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.distance,
    required this.isActive,
    required this.isRide,
    required this.earnings,
    required this.isManual,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'startTime': startTime,
        'endTime': endTime,
        'distance': distance,
        'isActive': isActive,
        'isRide': isRide,
        'earnings': earnings,
        'isManual': isManual,
      };

  factory Trip.fromJson(Map<String, dynamic> json) => Trip(
        id: json['id'],
        startTime: json['startTime'],
        endTime: json['endTime'],
        distance: (json['distance'] as num).toDouble(),
        isActive: json['isActive'],
        isRide: json['isRide'] ?? false,
        earnings: (json['earnings'] as num).toDouble(),
        isManual: json['isManual'] ?? false,
      );
}

class RideEntry {
  final int id;
  final String date;
  final double km;
  final double earnings;
  final double tip;
  final double totalEarnings;
  final double fuelUsed;
  final double fuelCost;
  final double profit;
  final double profitPerKm;
  final double costPerKm;
  final double mileageUsed;
  final String mileageSource;

  RideEntry({
    required this.id,
    required this.date,
    required this.km,
    required this.earnings,
    required this.tip,
    required this.totalEarnings,
    required this.fuelUsed,
    required this.fuelCost,
    required this.profit,
    required this.profitPerKm,
    required this.costPerKm,
    required this.mileageUsed,
    required this.mileageSource,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'date': date,
        'km': km,
        'earnings': earnings,
        'tip': tip,
        'totalEarnings': totalEarnings,
        'fuelUsed': fuelUsed,
        'fuelCost': fuelCost,
        'profit': profit,
        'profitPerKm': profitPerKm,
        'costPerKm': costPerKm,
        'mileageUsed': mileageUsed,
        'mileageSource': mileageSource,
      };

  factory RideEntry.fromJson(Map<String, dynamic> json) => RideEntry(
        id: json['id'],
        date: json['date'],
        km: (json['km'] as num).toDouble(),
        earnings: (json['earnings'] as num).toDouble(),
        tip: (json['tip'] as num).toDouble(),
        totalEarnings: (json['totalEarnings'] as num).toDouble(),
        fuelUsed: (json['fuelUsed'] as num).toDouble(),
        fuelCost: (json['fuelCost'] as num).toDouble(),
        profit: (json['profit'] as num).toDouble(),
        profitPerKm: (json['profitPerKm'] as num).toDouble(),
        costPerKm: (json['costPerKm'] as num).toDouble(),
        mileageUsed: (json['mileageUsed'] as num).toDouble(),
        mileageSource: json['mileageSource'] ?? '',
      );
}

// ==========================================
// RIDE STATE PROVIDER/CONTROLLER (Simple notifier)
// ==========================================

class TrackerStore extends ChangeNotifier {
  static final TrackerStore instance = TrackerStore._internal();
  TrackerStore._internal() {
    _loadFromPrefs();
  }

  String activeScreen = 'dashboard';
  List<PetrolEntry> petrolEntries = [];
  List<Trip> trips = [];
  Trip? currentTrip;
  double totalKmSinceLastFill = 0.0;
  List<RideEntry> rideEntries = [];

  bool isTracking = false;
  String gpsMessage = '';
  bool showGpsAlert = false;

  double smoothSpeed = 0.0;
  double gpsAccuracy = 0.0;
  String gpsStatus = 'Not started';

  StreamSubscription<Position>? _positionStream;
  Position? _lastPosition;

  // Search and filters
  String searchTerm = '';
  String historyFilter = '5-fill';

  // Calculator inputs
  String calcKm = '';
  String calcOffer = '';
  String calcMyPrice = '';
  Map<String, dynamic>? calculationResult;

  void changeScreen(String screen) {
    activeScreen = screen;
    notifyListeners();
  }

  // ==========================================
  // CALCULATING MILEAGE AND EFFICIENCIES
  // ==========================================

  double calculateRollingAverage({int windowSize = 5}) {
    if (petrolEntries.isEmpty) return 0.0;
    final recent = petrolEntries.sublist(0, math.min(windowSize, petrolEntries.length));
    final totalDistance = recent.fold<double>(0.0, (sum, entry) => sum + entry.kmTraveled);
    final totalLitres = recent.fold<double>(0.0, (sum, entry) => sum + entry.litres);
    return totalLitres > 0 ? totalDistance / totalLitres : 0.0;
  }

  double calculateAllTimeAverage() {
    if (petrolEntries.isEmpty) return 0.0;
    final totalDistance = petrolEntries.fold<double>(0.0, (sum, entry) => sum + entry.kmTraveled);
    final totalLitres = petrolEntries.fold<double>(0.0, (sum, entry) => sum + entry.litres);
    return totalLitres > 0 ? totalDistance / totalLitres : 0.0;
  }

  Map<String, dynamic> getEffectiveMileage() {
    if (petrolEntries.isEmpty) {
      return {'mileage': 0.0, 'source': 'none', 'isEstimated': false};
    }
    final lastEntry = petrolEntries[0];
    final rolling = calculateRollingAverage();

    final lastTankDistance = lastEntry.kmTraveled;
    final shouldUseFallback = lastTankDistance < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD;

    if (shouldUseFallback && rolling > 0 && petrolEntries.length >= 2) {
      return {
        'mileage': rolling,
        'source': 'rolling-average',
        'isEstimated': true
      };
    }

    final lastTankMileage = lastEntry.mileage > 0
        ? lastEntry.mileage
        : (lastEntry.litres > 0 && lastTankDistance > 0
            ? lastTankDistance / lastEntry.litres
            : 0.0);

    return {
      'mileage': lastTankMileage,
      'source': 'last-tank',
      'isEstimated': false
    };
  }

  // ==========================================
  // GPS TRACKING METHODS
  // ==========================================

  Future<void> startGPSTracking({bool isRide = false}) async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      _showGpsMessage('❌ Location services are disabled. Please enable them.');
      return;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        _showGpsMessage('❌ GPS permission denied.');
        return;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      _showGpsMessage('❌ GPS permissions permanently denied. Enable in Settings.');
      return;
    }

    isTracking = true;
    gpsStatus = 'Getting lock...';
    _lastPosition = null;
    smoothSpeed = 0.0;

    currentTrip = Trip(
      id: DateTime.now().millisecondsSinceEpoch,
      startTime: DateTime.now().toIso8601String(),
      endTime: '',
      distance: 0.0,
      isActive: true,
      isRide: isRide,
      earnings: 0.0,
      isManual: false,
    );
    notifyListeners();

    const LocationSettings locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 5,
    );

    _positionStream = Geolocator.getPositionStream(locationSettings: locationSettings).listen(
      (Position position) {
        gpsStatus = 'Active ✓';
        gpsAccuracy = position.accuracy;
        smoothSpeed = (position.speed >= 0 ? position.speed : 0.0) * 3.6; // convert m/s to km/h

        if (_lastPosition != null) {
          double distanceInMeters = Geolocator.distanceBetween(
            _lastPosition!.latitude,
            _lastPosition!.longitude,
            position.latitude,
            position.longitude,
          );

          if (distanceInMeters >= 10 && position.accuracy <= 30) {
            double distanceInKm = distanceInMeters / 1000.0;
            if (currentTrip != null) {
              currentTrip = Trip(
                id: currentTrip!.id,
                startTime: currentTrip!.startTime,
                endTime: currentTrip!.endTime,
                distance: currentTrip!.distance + distanceInKm,
                isActive: currentTrip!.isActive,
                isRide: currentTrip!.isRide,
                earnings: currentTrip!.earnings,
                isManual: currentTrip!.isManual,
              );
            }
            totalKmSinceLastFill += distanceInKm;
            _lastPosition = position;
          }
        } else {
          _lastPosition = position;
        }
        notifyListeners();
      },
      onError: (error) {
        _showGpsMessage('📡 GPS connection lost: $error');
        gpsStatus = 'No Signal';
        notifyListeners();
      },
    );

    _showGpsMessage(isRide ? '🟢 GPS Active (Ride Mode)' : '🟢 GPS Active (Personal Mode)');
  }

  void stopTracking(BuildContext context) {
    if (_positionStream != null) {
      _positionStream!.cancel();
      _positionStream = null;
    }

    if (currentTrip != null) {
      final actualKm = currentTrip!.distance;
      if (currentTrip!.isRide) {
        isTracking = false;
        gpsStatus = 'Stopped';
        smoothSpeed = 0.0;
        // Open ride completion dialog
        _showRideCompletionSheet(context, actualKm);
      } else {
        final completed = Trip(
          id: currentTrip!.id,
          startTime: currentTrip!.startTime,
          endTime: DateTime.now().toIso8601String(),
          distance: actualKm,
          isActive: false,
          isRide: false,
          earnings: 0.0,
          isManual: false,
        );
        trips.add(completed);
        currentTrip = null;
        isTracking = false;
        gpsStatus = 'Stopped';
        smoothSpeed = 0.0;
        _saveToPrefs();
        _showGpsMessage('⏸️ Personal Trip Stopped');
        notifyListeners();
      }
    }
  }

  void completeRideWithEarnings(double earnings, double tip) {
    if (currentTrip == null) return;
    final actualKm = currentTrip!.distance;

    final mileageData = getEffectiveMileage();
    double mileageVal = mileageData['mileage'];
    double fuelUsed = 0.0;
    double fuelCost = 0.0;
    double costPerKm = 0.0;

    if (petrolEntries.isNotEmpty && mileageVal > 0) {
      final lastEntry = petrolEntries[0];
      fuelUsed = actualKm / mileageVal;
      fuelCost = fuelUsed * lastEntry.pricePerLitre;
      costPerKm = lastEntry.pricePerLitre / mileageVal;
    }

    final totalEarnings = earnings + tip;
    final profit = totalEarnings - fuelCost;
    final profitPerKm = actualKm > 0 ? profit / actualKm : 0.0;

    final rideEntry = RideEntry(
      id: DateTime.now().millisecondsSinceEpoch,
      date: DateTime.now().toIso8601String(),
      km: actualKm,
      earnings: earnings,
      tip: tip,
      totalEarnings: totalEarnings,
      fuelUsed: fuelUsed,
      fuelCost: fuelCost,
      profit: profit,
      profitPerKm: profitPerKm,
      costPerKm: costPerKm,
      mileageUsed: mileageVal,
      mileageSource: mileageData['source'],
    );

    rideEntries.insert(0, rideEntry);

    final completedTrip = Trip(
      id: currentTrip!.id,
      startTime: currentTrip!.startTime,
      endTime: DateTime.now().toIso8601String(),
      distance: actualKm,
      isActive: false,
      isRide: true,
      earnings: totalEarnings,
      isManual: false,
    );

    trips.add(completedTrip);
    currentTrip = null;

    _saveToPrefs();
    notifyListeners();
  }

  // ==========================================
  // FORM / LOG ENTRIES ACTIONS
  // ==========================================

  void addPetrolEntry(double litresNum, double priceNum, String dateStr) {
    final tankMileage = totalKmSinceLastFill > 0 ? totalKmSinceLastFill / litresNum : 0.0;
    final isEstimated = totalKmSinceLastFill < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD;

    final entry = PetrolEntry(
      id: DateTime.now().millisecondsSinceEpoch,
      litres: litresNum,
      pricePerLitre: priceNum,
      totalCost: litresNum * priceNum,
      date: dateStr,
      kmTraveled: totalKmSinceLastFill,
      mileage: tankMileage,
      isEstimated: isEstimated,
      createdAt: DateTime.now().toIso8601String(),
    );

    petrolEntries.insert(0, entry);
    totalKmSinceLastFill = 0.0;
    trips.clear(); // clear intermediate trips

    _saveToPrefs();
    notifyListeners();
  }

  void addManualKm(double kmVal) {
    totalKmSinceLastFill += kmVal;
    final manualTrip = Trip(
      id: DateTime.now().millisecondsSinceEpoch,
      startTime: DateTime.now().toIso8601String(),
      endTime: DateTime.now().toIso8601String(),
      distance: kmVal,
      isActive: false,
      isRide: false,
      earnings: 0.0,
      isManual: true,
    );
    trips.add(manualTrip);
    _saveToPrefs();
    notifyListeners();
  }

  void addManualRide(double kmVal, double earningsVal, double tipVal) {
    final mileageData = getEffectiveMileage();
    double mileageVal = mileageData['mileage'];
    double fuelUsed = 0.0;
    double fuelCost = 0.0;
    double costPerKm = 0.0;

    if (petrolEntries.isNotEmpty && mileageVal > 0) {
      final lastEntry = petrolEntries[0];
      fuelUsed = kmVal / mileageVal;
      fuelCost = fuelUsed * lastEntry.pricePerLitre;
      costPerKm = lastEntry.pricePerLitre / mileageVal;
    }

    final totalEarnings = earningsVal + tipVal;
    final profit = totalEarnings - fuelCost;
    final profitPerKm = kmVal > 0 ? profit / kmVal : 0.0;

    final rideEntry = RideEntry(
      id: DateTime.now().millisecondsSinceEpoch,
      date: DateTime.now().toIso8601String(),
      km: kmVal,
      earnings: earningsVal,
      tip: tipVal,
      totalEarnings: totalEarnings,
      fuelUsed: fuelUsed,
      fuelCost: fuelCost,
      profit: profit,
      profitPerKm: profitPerKm,
      costPerKm: costPerKm,
      mileageUsed: mileageVal,
      mileageSource: mileageData['source'],
    );

    rideEntries.insert(0, rideEntry);
    totalKmSinceLastFill += kmVal;

    final manualTrip = Trip(
      id: DateTime.now().millisecondsSinceEpoch,
      startTime: DateTime.now().toIso8601String(),
      endTime: DateTime.now().toIso8601String(),
      distance: kmVal,
      isActive: false,
      isRide: true,
      earnings: totalEarnings,
      isManual: true,
    );
    trips.add(manualTrip);

    _saveToPrefs();
    notifyListeners();
  }

  // ==========================================
  // FARE CALCULATOR METHOD
  // ==========================================

  void runFareCalculator() {
    double km = double.tryParse(calcKm) ?? 0.0;
    double offer = double.tryParse(calcOffer) ?? 0.0;
    double counter = double.tryParse(calcMyPrice) ?? 0.0;

    if (km <= 0 || (offer <= 0 && counter <= 0)) return;

    final mileageData = getEffectiveMileage();
    double mileageVal = mileageData['mileage'];
    double costPerKm = 0.0;
    double fuelCost = 0.0;

    if (petrolEntries.isNotEmpty && mileageVal > 0) {
      final lastEntry = petrolEntries[0];
      fuelCost = (km / mileageVal) * lastEntry.pricePerLitre;
      costPerKm = lastEntry.pricePerLitre / mileageVal;
    } else {
      costPerKm = 15.0; // standard fallback
      fuelCost = km * costPerKm;
    }

    final offerProfit = offer - fuelCost;
    final myProfit = counter > 0 ? counter - fuelCost : 0.0;

    calculationResult = {
      'km': km,
      'fuelCost': fuelCost,
      'offerProfit': offerProfit,
      'myProfit': myProfit,
    };
    notifyListeners();
  }

  void clearCalculator() {
    calcKm = '';
    calcOffer = '';
    calcMyPrice = '';
    calculationResult = null;
    notifyListeners();
  }

  // ==========================================
  // RESET METHOD
  // ==========================================

  Future<void> resetAllData() async {
    if (_positionStream != null) {
      await _positionStream!.cancel();
      _positionStream = null;
    }
    petrolEntries.clear();
    trips.clear();
    currentTrip = null;
    totalKmSinceLastFill = 0.0;
    rideEntries.clear();
    isTracking = false;
    smoothSpeed = 0.0;
    calculationResult = null;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('petrolTrackerData');
    activeScreen = 'dashboard';
    notifyListeners();
  }

  // ==========================================
  // LOCAL CACHE STORAGE
  // ==========================================

  Future<void> _loadFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? jsonStr = prefs.getString('petrolTrackerData');
      if (jsonStr != null) {
        final Map<String, dynamic> data = jsonDecode(jsonStr);
        if (data.containsKey('petrolEntries')) {
          petrolEntries = (data['petrolEntries'] as List)
              .map((item) => PetrolEntry.fromJson(item))
              .toList();
        }
        if (data.containsKey('trips')) {
          trips = (data['trips'] as List).map((item) => Trip.fromJson(item)).toList();
        }
        if (data.containsKey('currentTrip') && data['currentTrip'] != null) {
          currentTrip = Trip.fromJson(data['currentTrip']);
        }
        if (data.containsKey('totalKmSinceLastFill')) {
          totalKmSinceLastFill = (data['totalKmSinceLastFill'] as num).toDouble();
        }
        if (data.containsKey('rideEntries')) {
          rideEntries = (data['rideEntries'] as List)
              .map((item) => RideEntry.fromJson(item))
              .toList();
        }
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Error loading preferences: $e');
    }
  }

  Future<void> _saveToPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final data = {
        'petrolEntries': petrolEntries.map((e) => e.toJson()).toList(),
        'trips': trips.map((e) => e.toJson()).toList(),
        'currentTrip': currentTrip?.toJson(),
        'totalKmSinceLastFill': totalKmSinceLastFill,
        'rideEntries': rideEntries.map((e) => e.toJson()).toList(),
      };
      await prefs.setString('petrolTrackerData', jsonEncode(data));
    } catch (e) {
      debugPrint('Error saving preferences: $e');
    }
  }

  void _showGpsMessage(String msg) {
    gpsMessage = msg;
    showGpsAlert = true;
    notifyListeners();
    Future.delayed(const Duration(seconds: 3), () {
      showGpsAlert = false;
      notifyListeners();
    });
  }

  void _showRideCompletionSheet(BuildContext context, double distance) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => RideCompletionDialog(distance: distance),
    );
  }
}

// ==========================================
// VIEWS / MAIN SCREEN LAYOUT
// ==========================================

class MainLayoutScreen extends StatefulWidget {
  const MainLayoutScreen({super.key});

  @override
  State<MainLayoutScreen> createState() => _MainLayoutScreenState();
}

class _MainLayoutScreenState extends State<MainLayoutScreen> {
  final TrackerStore store = TrackerStore.instance;

  @override
  void initState() {
    super.initState();
    store.addListener(_onStoreUpdate);
  }

  @override
  void dispose() {
    store.removeListener(_onStoreUpdate);
    super.dispose();
  }

  void _onStoreUpdate() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    Widget activeBody = const DashboardView();
    if (store.activeScreen == 'dashboard') activeBody = const DashboardView();
    if (store.activeScreen == 'fuel') activeBody = const AddFuelView();
    if (store.activeScreen == 'personal') activeBody = const PersonalTripView();
    if (store.activeScreen == 'ride') activeBody = const RideTripView();
    if (store.activeScreen == 'calculator') activeBody = const CalculatorView();
    if (store.activeScreen == 'history') activeBody = const HistoryView();

    return Scaffold(
      body: Stack(
        children: [
          // Background atmospheric shader
          Container(
            decoration: const BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0.8, -0.6),
                radius: 1.2,
                colors: [
                  Color(0x156DE9BE),
                  Color(0xFF0C1321),
                ],
              ),
            ),
          ),
          // Scrollable layout container
          SafeArea(
            child: Column(
              children: [
                if (store.activeScreen != 'fuel') const TopNavigationBar(),
                Expanded(
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
                    child: activeBody,
                  ),
                ),
              ],
            ),
          ),
          // GPS messages
          if (store.showGpsAlert)
            Positioned(
              top: 80,
              left: 20,
              right: 20,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xCC19202E),
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(color: Colors.white10),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.info, color: Color(0xFF6DE9BE)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        store.gpsMessage,
                        style: const TextStyle(fontSize: 13, color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: const PremiumBottomNavBar(),
    );
  }
}

// ==========================================
// TOP NAVBAR WIDGET
// ==========================================

class TopNavigationBar extends StatelessWidget {
  const TopNavigationBar({super.key});

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;

    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.white10, width: 0.5)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.between,
        children: [
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: Image.network(
                  'https://lh3.googleusercontent.com/aida-public/AB6AXuAwypJLKvxtRK9onddJsnySSnBtykPNYnwvx2kIRYVN5B9N9sof1pxLqBKclM8K00qRUiXpTiLyL-186UgoasEvyIvzgygtN-DB6Y5vP8JBUIUrj7QmwJxwaaeaKB1vo0JTL-gjr7omnSlYvyQPqqaGs_9qNNaoSUkCFrQoMfX4rkgKpHsbGiGC1EhX1Yxhfq_5FUJKJPyp1dAWp7TFxZeMa-KobvUICl3iX0JMw6kBGG6b41imZMMnrA',
                  width: 38,
                  height: 38,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const CircleAvatar(radius: 19, child: Icon(Icons.person)),
                ),
              ),
              const SizedBox(width: 10),
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: [Color(0xFF6DE9BE), Color(0xFF4ECCA3)],
                ).createShader(bounds),
                child: const Text(
                  'Petrol Tracker',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.restart_alt, color: Color(0xFFFFB4AB)),
                onPressed: () => _confirmResetDialog(context),
              ),
              IconButton(
                icon: const Icon(Icons.download, color: Color(0xFF6DE9BE)),
                onPressed: store.exportData,
              ),
            ],
          )
        ],
      ),
    );
  }

  void _confirmResetDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF19202E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.warning, color: Color(0xFFFFB4AB)),
            SizedBox(width: 10),
            Text('Confirm Reset'),
          ],
        ),
        content: const Text('Delete all data? This cannot be undone.'),
        actions: [
          TextButton(
            child: const Text('Cancel'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFFB4AB),
              foregroundColor: Colors.black,
            ),
            child: const Text('Yes, Delete'),
            onPressed: () {
              Navigator.pop(context);
              TrackerStore.instance.resetAllData();
            },
          ),
        ],
      ),
    );
  }
}

// ==========================================
// PREMIUM BOTTOM NAV BAR
// ==========================================

class PremiumBottomNavBar extends StatelessWidget {
  const PremiumBottomNavBar({super.key});

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;

    return Container(
      height: 70,
      margin: const EdgeInsets.only(bottom: 20, left: 20, right: 20),
      decoration: BoxDecoration(
        color: const Color(0xAA151B2A),
        borderRadius: BorderRadius.circular(35),
        border: Border.all(color: Colors.white10),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildNavItem(Icons.home, 'dashboard', store),
          _buildNavItem(Icons.local_gas_station, 'fuel', store),
          _buildNavItem(Icons.person, 'personal', store),
          _buildNavItem(Icons.directions_car, 'ride', store),
          _buildNavItem(Icons.calculate, 'calculator', store),
          _buildNavItem(Icons.history, 'history', store),
        ],
      ),
    );
  }

  Widget _buildNavItem(IconData icon, String screenName, TrackerStore store) {
    final isActive = store.activeScreen == screenName;

    return GestureDetector(
      onTap: () => store.changeScreen(screenName),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFF6DE9BE) : Colors.transparent,
          shape: BoxShape.circle,
          boxShadow: isActive
              ? const [
                  BoxShadow(
                    color: Color(0x406DE9BE),
                    blurRadius: 12,
                    spreadRadius: 2,
                  )
                ]
              : [],
        ),
        child: Icon(
          icon,
          color: isActive ? const Color(0xFF003829) : const Color(0xFF86948D),
          size: 24,
        ),
      ),
    );
  }
}

// ==========================================
// VIEW: DASHBOARD VIEW
// ==========================================

class DashboardView extends StatelessWidget {
  const DashboardView({super.key});

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;
    final monthly = store.getMonthlySummary;
    final lastEntry = store.petrolEntries.isEmpty ? null : store.petrolEntries[0];
    final mileageData = store.getEffectiveMileage();
    double mileageVal = mileageData['mileage'];

    // Map gauge values
    double percent = mileageVal / 40.0; // max expected 40
    percent = percent.clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Hero Section: Current Tank
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0x1A111C33),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.between,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Current Tank',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        lastEntry != null
                            ? 'Refilled on ${DateFormat('dd MMM').format(DateTime.parse(lastEntry.date))}'
                            : 'No petrol logged yet',
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF86948D),
                        ),
                      ),
                    ],
                  ),
                  if (mileageData['isEstimated'] == true)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, py: 4),
                      decoration: BoxDecoration(
                        color: const Color(0x33FFC8A1),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0x55FFC8A1)),
                      ),
                      child: const Text(
                        'EST',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFFFC8A1),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              // Gauge Progress Indicator
              Center(
                child: SizedBox(
                  width: 180,
                  height: 180,
                  child: CustomPaint(
                    painter: CircularProgressPainter(
                      progress: percent,
                      primaryColor: const Color(0xFF6DE9BE),
                      trackColor: const Color(0x1F2E3544),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Text(
                            'Efficiency',
                            style: TextStyle(fontSize: 11, color: Color(0xFF86948D), letterSpacing: 1.5),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            mileageVal > 0 ? mileageVal.toStringAsFixed(1) : '0.0',
                            style: const TextStyle(
                              fontSize: 36,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF6DE9BE),
                            ),
                          ),
                          const Text(
                            'km/L',
                            style: TextStyle(fontSize: 13, color: Color(0xFF86948D)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              // Footer Stats
              Container(
                padding: const EdgeInsets.only(top: 16),
                border: const Border(top: BorderSide(color: Colors.white10)),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Fuel Vol. (Last Fill)',
                            style: TextStyle(fontSize: 11, color: Color(0xFF86948D)),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text(
                                lastEntry != null ? lastEntry.litres.toStringAsFixed(1) : '0.0',
                                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(width: 4),
                              const Text('L', style: TextStyle(fontSize: 12, color: Color(0xFF86948D))),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          const Text(
                            'Distance (This Tank)',
                            style: TextStyle(fontSize: 11, color: Color(0xFF86948D)),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text(
                                store.totalKmSinceLastFill.toStringAsFixed(1),
                                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(width: 4),
                              const Text('km', style: TextStyle(fontSize: 12, color: Color(0xFF86948D))),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              )
            ],
          ),
        ),
        const SizedBox(height: 20),
        // Quick Action Buttons
        Row(
          children: [
            Expanded(
              child: GestureDetector(
                onTap: () => _showAddManualKmDialog(context),
                child: _buildActionCard(
                  Icons.add_road,
                  'Add Manual KM',
                  const Color(0xFF6DE9BE),
                ),
              ),
            ),
            const SizedBox(width: 15),
            Expanded(
              child: GestureDetector(
                onTap: () => _showAddManualRideDialog(context),
                child: _buildActionCard(
                  Icons.app_shortcut,
                  'Log Ride Manually',
                  const Color(0xFFB9C3FF),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        // Monthly Summary
        Row(
          mainAxisAlignment: MainAxisAlignment.between,
          children: [
            const Text(
              'This Month',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            TextButton(
              onPressed: () => store.changeScreen('history'),
              child: const Row(
                children: [
                  Text('View History'),
                  Icon(Icons.chevron_right, size: 18),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 15,
          crossAxisSpacing: 15,
          childAspectRatio: 1.4,
          children: [
            _buildMonthlyCard(
              Icons.water_drop,
              'Total Fuel',
              '${monthly.totalLitres.toStringAsFixed(1)} L',
              const Color(0xFF6DE9BE),
            ),
            _buildMonthlyCard(
              Icons.payments,
              'Total Spent',
              'PKR ${monthly.totalSpent.toStringAsFixed(0)}',
              const Color(0xFFB9C3FF),
            ),
            _buildMonthlyCard(
              Icons.route,
              'Distance',
              '${monthly.totalKm.toStringAsFixed(1)} km',
              const Color(0xFFFFC8A1),
            ),
            _buildMonthlyCard(
              Icons.trending_up,
              'Avg Cons.',
              '${monthly.avgMileage} km/L',
              const Color(0xFF6DE9BE),
            ),
          ],
        ),
        const SizedBox(height: 30),
      ],
    );
  }

  Widget _buildActionCard(IconData icon, String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: const Color(0x1A111C33),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(height: 8),
          Text(
            text,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          )
        ],
      ),
    );
  }

  Widget _buildMonthlyCard(IconData icon, String title, String val, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0x1A111C33),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 6),
              Text(title, style: const TextStyle(fontSize: 12, color: Color(0xFF86948D))),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            val,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          )
        ],
      ),
    );
  }

  void _showAddManualKmDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF19202E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Add Manual KM'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Enter kilometers',
            suffixText: 'km',
          ),
        ),
        actions: [
          TextButton(
            child: const Text('Cancel'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6DE9BE), foregroundColor: Colors.black),
            child: const Text('Add'),
            onPressed: () {
              double? val = double.tryParse(controller.text);
              if (val != null && val > 0) {
                TrackerStore.instance.addManualKm(val);
                Navigator.pop(context);
              }
            },
          ),
        ],
      ),
    );
  }

  void _showAddManualRideDialog(BuildContext context) {
    final kmController = TextEditingController();
    final earningsController = TextEditingController();
    final tipController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF19202E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Log Ride Manually'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: kmController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Distance (km)'),
            ),
            TextField(
              controller: earningsController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Base Fare (PKR)'),
            ),
            TextField(
              controller: tipController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Tip (Optional, PKR)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            child: const Text('Cancel'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6DE9BE), foregroundColor: Colors.black),
            child: const Text('Log'),
            onPressed: () {
              double? km = double.tryParse(kmController.text);
              double? earnings = double.tryParse(earningsController.text);
              double tip = double.tryParse(tipController.text) ?? 0.0;

              if (km != null && km > 0 && earnings != null && earnings >= 0) {
                TrackerStore.instance.addManualRide(km, earnings, tip);
                Navigator.pop(context);
              }
            },
          ),
        ],
      ),
    );
  }
}

// Custom Painter for circular dashboard progress ring
class CircularProgressPainter extends CustomPainter {
  final double progress;
  final Color primaryColor;
  final Color trackColor;

  CircularProgressPainter({
    required this.progress,
    required this.primaryColor,
    required this.trackColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 8;

    final trackPaint = Paint()
      ..color = trackColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.0;

    final progressPaint = Paint()
      ..color = primaryColor
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 8.0;

    canvas.drawCircle(center, radius, trackPaint);

    double sweepAngle = 2 * math.pi * progress;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      sweepAngle,
      false,
      progressPaint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

// ==========================================
// VIEW: ADD FUEL VIEW
// ==========================================

class AddFuelView extends StatefulWidget {
  const AddFuelView({super.key});

  @override
  State<AddFuelView> createState() => _AddFuelViewState();
}

class _AddFuelViewState extends State<AddFuelView> {
  final litresController = TextEditingController();
  final priceController = TextEditingController();
  DateTime selectedDate = DateTime.now();

  double estimatedTotal = 0.0;

  @override
  void initState() {
    super.initState();
    litresController.addListener(_updateTotal);
    priceController.addListener(_updateTotal);
  }

  @override
  void dispose() {
    litresController.dispose();
    priceController.dispose();
    super.dispose();
  }

  void _updateTotal() {
    double litres = double.tryParse(litresController.text) ?? 0.0;
    double price = double.tryParse(priceController.text) ?? 0.0;
    setState(() {
      estimatedTotal = litres * price;
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;
    final hasLowDistance = store.totalKmSinceLastFill > 0 && store.totalKmSinceLastFill < 100;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.arrow_back, color: Color(0xFF6DE9BE)),
              onPressed: () => store.changeScreen('dashboard'),
            ),
            const Text(
              'Add Fuel Entry',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        const SizedBox(height: 20),
        if (hasLowDistance)
          Container(
            padding: const EdgeInsets.all(16),
            margin: const EdgeInsets.bottom(20),
            decoration: BoxDecoration(
              color: const Color(0x1AFFC8A1),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0x33FFC8A1)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.warning, color: Color(0xFFFFC8A1)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Low Distance Alert',
                        style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFFFC8A1)),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Only ${store.totalKmSinceLastFill.toStringAsFixed(1)} km since last fill. Estimated consumption calculations will be skewed.',
                        style: const TextStyle(fontSize: 13, color: Colors.white70),
                      ),
                    ],
                  ),
                )
              ],
            ),
          ),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0x1A111C33),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Litres
              const Text('Fuel Quantity (Litres)', style: TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 8),
              TextField(
                controller: litresController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.local_gas_station),
                  border: OutlineInputBorder(),
                  hintText: '0.00',
                ),
              ),
              const SizedBox(height: 20),
              // Price
              const Text('Price per Litre (PKR)', style: TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 8),
              TextField(
                controller: priceController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.payments),
                  border: OutlineInputBorder(),
                  hintText: '0.00',
                ),
              ),
              const SizedBox(height: 20),
              // Date picker trigger
              const Text('Transaction Date', style: TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: selectedDate,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now(),
                  );
                  if (picked != null) {
                    setState(() {
                      selectedDate = picked;
                    });
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.white30),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.calendar_today, color: Colors.white60),
                      const SizedBox(width: 12),
                      Text(
                        DateFormat('yyyy-MM-dd').format(selectedDate),
                        style: const TextStyle(fontSize: 16),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              // Live Total
              Row(
                mainAxisAlignment: MainAxisAlignment.between,
                children: [
                  const Text('Estimated Total', style: TextStyle(color: Colors.white70)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0x336DE9BE),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0x666DE9BE)),
                    ),
                    child: Text(
                      'PKR ${estimatedTotal.toStringAsFixed(2)}',
                      style: const TextStyle(color: Color(0xFF6DE9BE), fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF6DE9BE),
            foregroundColor: Colors.black,
            padding: const EdgeInsets.symmetric(vertical: 18),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          ),
          onPressed: () {
            double? litres = double.tryParse(litresController.text);
            double? price = double.tryParse(priceController.text);
            if (litres != null && litres > 0 && price != null && price > 0) {
              store.addPetrolEntry(litres, price, DateFormat('yyyy-MM-dd').format(selectedDate));
              store.changeScreen('dashboard');
            }
          },
          child: const Text('Save Entry', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }
}

// ==========================================
// VIEW: PERSONAL TRIP VIEW
// ==========================================

class PersonalTripView extends StatefulWidget {
  const PersonalTripView({super.key});

  @override
  State<PersonalTripView> createState() => _PersonalTripViewState();
}

class _PersonalTripViewState extends State<PersonalTripView> {
  Timer? _timer;
  Duration _tripDuration = Duration.zero;

  @override
  void initState() {
    super.initState();
    if (TrackerStore.instance.isTracking) {
      _startTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startTimer() {
    final start = DateTime.parse(TrackerStore.instance.currentTrip!.startTime);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (mounted) {
        setState(() {
          _tripDuration = DateTime.now().difference(start);
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;
    final isTracking = store.isTracking;

    return Column(
      children: [
        const Text(
          'Personal Trip',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const Text(
          'Live mileage & tracking stats',
          style: TextStyle(fontSize: 13, color: Color(0xFF86948D)),
        ),
        const SizedBox(height: 25),
        // Searching GPS lock toast inside view
        if (isTracking && store.gpsStatus.contains('Getting'))
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: const Color(0x22FFC8A1),
              borderRadius: BorderRadius.circular(15),
              border: Border.all(color: const Color(0x33FFC8A1)),
            ),
            child: const Row(
              children: [
                Icon(Icons.satellite_alt, color: Color(0xFFFFC8A1)),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Searching for GPS signal...',
                    style: TextStyle(fontSize: 13, color: Color(0xFFFFC8A1)),
                  ),
                ),
              ],
            ),
          ),
        // Speedometer UI
        Center(
          child: Container(
            width: 220,
            height: 220,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
            ),
            child: Stack(
              children: [
                SizedBox(
                  width: 220,
                  height: 220,
                  child: CustomPaint(
                    painter: CircularProgressPainter(
                      progress: store.smoothSpeed / 100.0,
                      primaryColor: const Color(0xFF6DE9BE),
                      trackColor: const Color(0x1F2E3544),
                    ),
                  ),
                ),
                Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        store.smoothSpeed.toStringAsFixed(0),
                        style: const TextStyle(
                          fontSize: 64,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF6DE9BE),
                        ),
                      ),
                      const Text(
                        'km/h',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF86948D),
                          letterSpacing: 1.5,
                        ),
                      )
                    ],
                  ),
                )
              ],
            ),
          ),
        ),
        const SizedBox(height: 30),
        // Trip Stats Grid
        Row(
          children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0x1A111C33),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.timer, size: 18, color: Colors.white50),
                        SizedBox(width: 6),
                        Text('Time Active', style: TextStyle(fontSize: 12, color: Color(0xFF86948D))),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      isTracking ? _formatDuration(_tripDuration) : '0:00',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    )
                  ],
                ),
              ),
            ),
            const SizedBox(width: 15),
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0x1A111C33),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.route, size: 18, color: Colors.white50),
                        SizedBox(width: 6),
                        Text('Distance', style: TextStyle(fontSize: 12, color: Color(0xFF86948D))),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${(store.currentTrip?.distance ?? 0.0).toStringAsFixed(2)} km',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    )
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 40),
        // Action Button
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: isTracking ? const Color(0xFFFFB4AB) : const Color(0xFF6DE9BE),
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 18),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
            ),
            onPressed: () {
              if (isTracking) {
                store.stopTracking(context);
                _timer?.cancel();
                _tripDuration = Duration.zero;
              } else {
                store.startGPSTracking(isRide: false);
                _startTimer();
              }
            },
            child: Text(
              isTracking ? 'Stop Tracking' : 'Start Tracking',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ),
        )
      ],
    );
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    final minutes = twoDigits(d.inMinutes.remainder(60));
    final seconds = twoDigits(d.inSeconds.remainder(60));
    return "${d.inHours > 0 ? '${d.inHours}:' : ''}$minutes:$seconds";
  }
}

// ==========================================
// VIEW: RIDE TRIP VIEW
// ==========================================

class RideTripView extends StatelessWidget {
  const RideTripView({super.key});

  @override
  Widget build(BuildContext context) {
    final store = TrackerStore.instance;
    final summary = store.getRideSummary;
    final isTracking = store.isTracking;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Hero Profits
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0x1A111C33),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            children: [
              const Text(
                "Today's Net Profit",
                style: TextStyle(fontSize: 13, color: Color(0xFFB9C3FF), letterSpacing: 1.5, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  const Text('PKR', style: TextStyle(fontSize: 16, color: Colors.white70)),
                  const SizedBox(width: 4),
                  Text(
                    summary.totalProfit.toStringAsFixed(2),
                    style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w900, color: Colors.white),
                  )
                ],
              ),
              const SizedBox(height: 15),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, py: 6),
                decoration: BoxDecoration(
                  color: const Color(0x226DE9BE),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0x446DE9BE)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.trending_up, color: Color(0xFF6DE9BE), size: 16),
                    SizedBox(width: 6),
                    Text('Earnings Active', style: TextStyle(fontSize: 11, color: Color(0xFF6DE9BE), fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            ],
          ),
        ),
        const SizedBox(height: 20),
        // Stats Bento Grid
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 15,
          crossAxisSpacing: 15,
          childAspectRatio: 1.5,
          children: [
            _buildBentoItem(Icons.directions_car, 'Total Rides', '${summary.totalRides}'),
            _buildBentoItem(Icons.route, 'Distance', '${summary.totalRideKm.toStringAsFixed(1)} km'),
            _buildBentoItem(Icons.payments, 'Gross Earnings', 'PKR ${summary.totalEarnings.toStringAsFixed(0)}'),
            _buildBentoItem(Icons.volunteer_activism, 'Tips Collected', 'PKR ${summary.totalTips.toStringAsFixed(0)}'),
            _buildBentoItem(Icons.local_gas_station, 'Fuel Cost', '-PKR ${summary.totalFuelCost.toStringAsFixed(0)}', isLoss: true),
            _buildBentoItem(Icons.query_stats, 'Avg / KM', 'PKR ${summary.avgProfitPerKm.toStringAsFixed(2)}'),
          ],
        ),
        const SizedBox(height: 20),
        // Live Ride section if tracking
        if (isTracking && store.currentTrip?.isRide == true)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0x226DE9BE),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0x446DE9BE)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.between,
                  children: [
                    const Text('Live Tracking Ride...', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6DE9BE))),
                    Text('${store.currentTrip!.distance.toStringAsFixed(2)} km', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 12),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFFB4AB), foregroundColor: Colors.black),
                  onPressed: () => store.stopTracking(context),
                  child: const Text('End Ride & Record Earnings'),
                )
              ],
            ),
          ),
        const SizedBox(height: 20),
        // Recent Rides
        if (!isTracking) ...[
          const Text('Recent Rides', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          if (store.rideEntries.isEmpty)
            const Text('No rides logged yet.', style: TextStyle(color: Colors.white50, fontSize: 13))
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: math.min(5, store.rideEntries.length),
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, idx) {
                final ride = store.rideEntries[idx];
                return Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0x1A111C33),
                    borderRadius: BorderRadius.circular(15),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.between,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(color: const Color(0x226DE9BE), borderRadius: BorderRadius.circular(8)),
                            child: const Icon(Icons.directions_car, color: Color(0xFF6DE9BE), size: 18),
                          ),
                          const SizedBox(width: 12),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Ride Entry', style: TextStyle(fontWeight: FontWeight.bold)),
                              Text(
                                '${ride.km.toStringAsFixed(1)} km • ${DateFormat('dd MMM').format(DateTime.parse(ride.date))}',
                                style: const TextStyle(fontSize: 11, color: Colors.white50),
                              )
                            ],
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('+PKR ${ride.profit.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6DE9BE))),
                          const Text('Net Profit', style: TextStyle(fontSize: 10, color: Colors.white50)),
                        ],
                      )
                    ],
                  ),
                );
              },
            ),
          const SizedBox(height: 20),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFB9C3FF),
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 18),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
            ),
            onPressed: () => store.startGPSTracking(isRide: true),
            child: const Text('Start Next Ride (GPS)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 30),
        ]
      ],
    );
  }

  Widget _buildBentoItem(IconData icon, String label, String val, {bool isLoss = false}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0x1A111C33),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: isLoss ? const Color(0xFFFFB4AB) : const Color(0xFFB9C3FF), size: 18),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.white50)),
          const SizedBox(height: 4),
          Text(val, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: isLoss ? const Color(0xFFFFB4AB) : Colors.white)),
        ],
      ),
    );
  }
}

// ==========================================
// DIALOG: RIDE COMPLETION
// ==========================================

class RideCompletionDialog extends StatefulWidget {
  final double distance;
  const RideCompletionDialog({super.key, required this.distance});

  @override
  State<RideCompletionDialog> createState() => _RideCompletionDialogState();
}

class _RideCompletionDialogState extends State<RideCompletionDialog> {
  final earningsController = TextEditingController();
  final tipController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF19202E),
        borderRadius: BorderRadius.vertical(top: Radius.circular(25)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(color: Color(0x226DE9BE), shape: BoxShape.circle),
                child: const Icon(Icons.directions_car, color: Color(0xFF6DE9BE)),
              ),
              const SizedBox(width: 12),
              const Text('Complete Ride', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 16),
            decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(15)),
            child: Column(
              children: [
                const Text('Distance Covered', style: TextStyle(fontSize: 12, color: Colors.white50)),
                const SizedBox(height: 4),
                Text(
                  '${widget.distance.toStringAsFixed(2)} km',
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Color(0xFF6DE9BE)),
                )
              ],
            ),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: earningsController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Base Fare (PKR)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 15),
          TextField(
            controller: tipController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Tip (Optional, PKR)',
              border: OutlineInputBorder(),
              suffixIcon: Icon(Icons.card_giftcard, color: Colors.white30),
            ),
          ),
          const SizedBox(height: 15),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: const Color(0x1AFFC8A1), borderRadius: BorderRadius.circular(10)),
            child: const Row(
              children: [
                Icon(Icons.warning, color: Color(0xFFFFC8A1), size: 18),
                SizedBox(width: 10),
                Expanded(child: Text('Verify fare amounts before completing.', style: TextStyle(fontSize: 11, color: Color(0xFFFFC8A1)))),
              ],
            ),
          ),
          const SizedBox(height: 20),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFB9C3FF),
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () {
              double? earnings = double.tryParse(earningsController.text);
              double tip = double.tryParse(tipController.text) ?? 0.0;
              if (earnings != null && earnings >= 0) {
                TrackerStore.instance.completeRideWithEarnings(earnings, tip);
                Navigator.pop(context);
              }
            },
            child: const Text('Complete Ride', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          const SizedBox(height: 10),
          TextButton(
            onPressed: () {
              TrackerStore.instance.completeRideWithEarnings(0.0, 0.0);
              Navigator.pop(context);
            },
            child: const Text('Skip / Discard', style: TextStyle(color: Colors.white50)),
          )
        ],
      ),
    );
  }
}

// ==========================================
// VIEW: FARE CALCULATOR VIEW
// ==========================================

class CalculatorView extends StatefulWidget {
  const CalculatorView({super.key});

  @override
  State<CalculatorView> createState() => _CalculatorViewState();
}

class _CalculatorViewState extends State<CalculatorView> {
  final store = TrackerStore.instance;

  @override
  Widget build(BuildContext context) {
    final result = store.calculationResult;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Fare Calculator', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        const Text('Analyze trip profitability before you accept.', style: TextStyle(color: Colors.white50, fontSize: 13)),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0x1A111C33),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            children: [
              TextField(
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Distance (km)', prefixIcon: Icon(Icons.route)),
                onChanged: (val) => store.calcKm = val,
                controller: TextEditingController(text: store.calcKm)..selection = TextSelection.collapsed(offset: store.calcKm.length),
              ),
              const SizedBox(height: 15),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Cust. Offer (PKR)', prefixIcon: Icon(Icons.person)),
                      onChanged: (val) => store.calcOffer = val,
                      controller: TextEditingController(text: store.calcOffer)..selection = TextSelection.collapsed(offset: store.calcOffer.length),
                    ),
                  ),
                  const SizedBox(width: 15),
                  Expanded(
                    child: TextField(
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Counter Offer (PKR)', prefixIcon: Icon(Icons.edit)),
                      onChanged: (val) => store.calcMyPrice = val,
                      controller: TextEditingController(text: store.calcMyPrice)..selection = TextSelection.collapsed(offset: store.calcMyPrice.length),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: store.clearCalculator,
                      child: const Text('Clear'),
                    ),
                  ),
                  const SizedBox(width: 15),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6DE9BE), foregroundColor: Colors.black),
                      onPressed: store.runFareCalculator,
                      child: const Text('Calculate'),
                    ),
                  ),
                ],
              )
            ],
          ),
        ),
        const SizedBox(height: 20),
        // Results
        if (result != null) ...[
          Row(
            children: [
              Expanded(
                child: _buildResultChip('Est. Cost', 'PKR ${result['fuelCost'].toStringAsFixed(0)}', const Color(0xFFFFB4AB)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildResultChip('Cust. Profit', 'PKR ${result['offerProfit'].toStringAsFixed(0)}', const Color(0xFF6DE9BE)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildResultChip('Counter P.', 'PKR ${result['myProfit'].toStringAsFixed(0)}', const Color(0xFFB9C3FF)),
              ),
            ],
          ),
          const SizedBox(height: 15),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: result['offerProfit'] > 100
                  ? const Color(0x226DE9BE)
                  : result['offerProfit'] > 0
                      ? const Color(0x22FFC8A1)
                      : const Color(0x22FFB4AB),
              borderRadius: BorderRadius.circular(15),
              border: Border.all(
                color: result['offerProfit'] > 100
                    ? const Color(0xFF6DE9BE)
                    : result['offerProfit'] > 0
                        ? const Color(0xFFFFC8A1)
                        : const Color(0xFFFFB4AB),
                width: 0.5,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  result['offerProfit'] > 100
                      ? Icons.verified
                      : result['offerProfit'] > 0
                          ? Icons.trending_flat
                          : Icons.warning,
                  color: result['offerProfit'] > 100
                      ? const Color(0xFF6DE9BE)
                      : result['offerProfit'] > 0
                          ? const Color(0xFFFFC8A1)
                          : const Color(0xFFFFB4AB),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    result['offerProfit'] > 100
                        ? 'Good Deal - Highly Profitable'
                        : result['offerProfit'] > 0
                            ? 'Fair Deal - Stable Margin'
                            : 'Low Profit - High Fuel Cost',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: result['offerProfit'] > 100
                          ? const Color(0xFF6DE9BE)
                          : result['offerProfit'] > 0
                              ? const Color(0xFFFFC8A1)
                              : const Color(0xFFFFB4AB),
                    ),
                  ),
                )
              ],
            ),
          )
        ]
      ],
    );
  }

  Widget _buildResultChip(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0x0F111C33),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 10, color: Colors.white50)),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: color),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

// ==========================================
// VIEW: FUEL HISTORY VIEW
// ==========================================

class HistoryView extends StatefulWidget {
  const HistoryView({super.key});

  @override
  State<HistoryView> createState() => _HistoryViewState();
}

class _HistoryViewState extends State<HistoryView> {
  final store = TrackerStore.instance;

  @override
  Widget build(BuildContext context) {
    final rolling = store.calculateRollingAverage();
    final allTime = store.calculateAllTimeAverage();
    final activeAvg = store.historyFilter == '5-fill' ? rolling : allTime;
    final monthly = store.getMonthlySummary;

    final filtered = store.petrolEntries.where((entry) {
      final formatted = DateFormat('dd MMM yyyy').format(DateTime.parse(entry.date));
      return formatted.toLowerCase().contains(store.searchTerm.toLowerCase());
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.between,
          children: [
            const Text('Fuel History', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
            Row(
              children: [
                _buildFilterBtn('5-Fill', '5-fill'),
                const SizedBox(width: 8),
                _buildFilterBtn('All-Time', 'all-time'),
              ],
            )
          ],
        ),
        const SizedBox(height: 20),
        // Stats strip
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0x1A111C33),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Avg. Efficiency', style: TextStyle(fontSize: 11, color: Colors.white50)),
                  const SizedBox(height: 4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        activeAvg > 0 ? activeAvg.toStringAsFixed(1) : '0.0',
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFF6DE9BE)),
                      ),
                      const SizedBox(width: 4),
                      const Text('km/L', style: TextStyle(fontSize: 12, color: Colors.white50)),
                    ],
                  ),
                ],
              ),
              Container(width: 1, height: 35, color: Colors.white10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Total Spent', style: TextStyle(fontSize: 11, color: Colors.white50)),
                  const SizedBox(height: 4),
                  Text(
                    'PKR ${monthly.totalSpent.toStringAsFixed(0)}',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                ],
              )
            ],
          ),
        ),
        const SizedBox(height: 20),
        // Search
        TextField(
          decoration: const InputDecoration(
            hintText: 'Search date (e.g. 24 Oct)...',
            prefixIcon: Icon(Icons.search),
            border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(30))),
          ),
          onChanged: (val) {
            setState(() {
              store.searchTerm = val;
            });
          },
        ),
        const SizedBox(height: 20),
        // List entries
        if (filtered.isEmpty)
          const Center(child: Text('No fuel entries found.', style: TextStyle(color: Colors.white50)))
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: filtered.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, idx) {
              final entry = filtered[idx];
              final dateStr = DateFormat('dd MMM yyyy').format(DateTime.parse(entry.date));

              return Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0x1A111C33),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.between,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(dateStr, style: const TextStyle(fontWeight: FontWeight.bold)),
                            const Text('Fuel Refill Entry', style: TextStyle(fontSize: 11, color: Colors.white50)),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text('PKR ${entry.totalCost.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6DE9BE))),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, py: 2),
                              decoration: BoxDecoration(color: const Color(0x226DE9BE), borderRadius: BorderRadius.circular(10)),
                              child: Text(
                                '${entry.litres.toStringAsFixed(1)} L',
                                style: const TextStyle(fontSize: 10, color: Color(0xFF6DE9BE), fontWeight: FontWeight.bold),
                              ),
                            )
                          ],
                        )
                      ],
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.only(top: 10),
                      border: const Border(top: BorderSide(color: Colors.white10)),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Efficiency', style: TextStyle(fontSize: 10, color: Colors.white50)),
                                Row(
                                  children: [
                                    Text(
                                      entry.mileage > 0 ? entry.mileage.toStringAsFixed(1) : 'N/A',
                                      style: const TextStyle(fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(width: 4),
                                    const Text('km/L', style: TextStyle(fontSize: 10, color: Colors.white50)),
                                    if (entry.isEstimated) ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 4, py: 1),
                                        decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(4)),
                                        child: const Text('EST', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold)),
                                      )
                                    ]
                                  ],
                                )
                              ],
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                const Text('Trip Distance', style: TextStyle(fontSize: 10, color: Colors.white50)),
                                Text(
                                  '${entry.kmTraveled.toStringAsFixed(1)} km',
                                  style: const TextStyle(fontWeight: FontWeight.bold),
                                )
                              ],
                            ),
                          )
                        ],
                      ),
                    )
                  ],
                ),
              );
            },
          ),
        const SizedBox(height: 30),
      ],
    );
  }

  Widget _buildFilterBtn(String label, String filterVal) {
    final active = store.historyFilter == filterVal;

    return GestureDetector(
      onTap: () {
        setState(() {
          store.historyFilter = filterVal;
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? const Color(0x336DE9BE) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: active ? const Color(0xFF6DE9BE) : Colors.white12),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: active ? const Color(0xFF6DE9BE) : Colors.white60,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}
