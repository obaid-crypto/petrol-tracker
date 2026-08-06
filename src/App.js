import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

// Mileage calculation configuration
const MILEAGE_CONFIG = {
    MIN_DISTANCE_THRESHOLD: 20, // km - minimum distance to trust single-tank mileage
    ROLLING_WINDOW: 5, // number of recent fills to average
    ENABLE_ALL_TIME_AVG: true // show long-term average stat
};

function App() {
    const [activeScreen, setActiveScreen] = useState('dashboard');
    const [petrolEntries, setPetrolEntries] = useState([]);
    const [trips, setTrips] = useState([]);
    const [currentTrip, setCurrentTrip] = useState(null);
    const [totalKmSinceLastFill, setTotalKmSinceLastFill] = useState(0);

    const [litres, setLitres] = useState('');
    const [pricePerLitre, setPricePerLitre] = useState('');
    const [fillDate, setFillDate] = useState(new Date().toISOString().split('T')[0]);

    const [isTracking, setIsTracking] = useState(false);
    const [gpsMessage, setGpsMessage] = useState('');
    const [showGpsAlert, setShowGpsAlert] = useState(false);

    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [canInstall, setCanInstall] = useState(false);

    const [showManualEntry, setShowManualEntry] = useState(false);
    const [manualKm, setManualKm] = useState('');

    const [showRideEntry, setShowRideEntry] = useState(false);
    const [earningsView, setEarningsView] = useState('daily');
    const [expandedDay, setExpandedDay] = useState(null);
    const [rideKm, setRideKm] = useState('');
    const [rideEarnings, setRideEarnings] = useState('');
    const [rideTip, setRideTip] = useState('');
    const [rideEntries, setRideEntries] = useState([]);

    const [showRideCompletionDialog, setShowRideCompletionDialog] = useState(false);
    const [completedRideKm, setCompletedRideKm] = useState(0);

    // Fare Calculator States
    const [calcKm, setCalcKm] = useState('');
    const [calcOffer, setCalcOffer] = useState('');
    const [calcMyPrice, setCalcMyPrice] = useState('');
    const [calculationResult, setCalculationResult] = useState(null);

    const [gpsDebug, setGpsDebug] = useState({
        updates: 0,
        lastLat: 0,
        lastLng: 0,
        accuracy: 0,
        speed: 0,
        status: 'Not started',
        lastDistance: 0
    });

    const [smoothSpeed, setSmoothSpeed] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');

    // Reserve Tracking States
    const [reserveActive, setReserveActive] = useState(false);
    const [reserveStartDistance, setReserveStartDistance] = useState(0);
    const [manualReserveDistance, setManualReserveDistance] = useState(0);
    const [fallbackReserveDistance, setFallbackReserveDistance] = useState('');
    const [showAddReserveModal, setShowAddReserveModal] = useState(false);
    const [addReserveInput, setAddReserveInput] = useState('');

    // --- Signal-loss estimation state ---
    const [gpsSignalLost, setGpsSignalLost] = useState(false);
    const [lastKnownSpeed, setLastKnownSpeed] = useState(0); // m/s
    const [estimatedDistance, setEstimatedDistance] = useState(0); // km, current gap
    const [totalEstimatedKm, setTotalEstimatedKm] = useState(0); // km, total for current trip
    const [hasEstimatedSegment, setHasEstimatedSegment] = useState(false);
    const [signalLostAt, setSignalLostAt] = useState(null);

    const consecutiveTimeoutsRef = useRef(0);
    const estimationTimerRef = useRef(null);
    const lastKnownSpeedRef = useRef(0);
    const estimatedDistanceRef = useRef(0);
    const recentPositionsRef = useRef([]);
    const isRideRef = useRef(false);

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);
    const positionCountRef = useRef(0);
    const positionHistoryRef = useRef([]);
    const isFirstPositionAfterStart = useRef(true);

    const gpsSignalLossBannerMessage = useMemo(() => {
        if (!gpsSignalLost || !signalLostAt) return '';
        const elapsedMin = Math.floor((Date.now() - signalLostAt) / 60000);
        if (elapsedMin >= 5) {
            return `⚠️ Long GPS gap detected (${elapsedMin} min). Please verify distance manually when you stop.`;
        }
        return `📡 GPS Signal Lost — estimating distance using last known speed ${(lastKnownSpeed * 3.6).toFixed(1)} km/h`;
    }, [gpsSignalLost, signalLostAt, lastKnownSpeed]);

    const calculateRollingAverage = useCallback((entries, windowSize = MILEAGE_CONFIG.ROLLING_WINDOW) => {
        if (!entries || entries.length === 0) return 0;
        const recentEntries = entries.slice(0, Math.min(windowSize, entries.length));
        const totalDistance = recentEntries.reduce((sum, entry) => sum + (entry.mainTankDistance ?? entry.kmTraveled ?? 0), 0);
        const totalLitres = recentEntries.reduce((sum, entry) => sum + entry.litres, 0);
        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const calculateAllTimeAverage = useCallback((entries) => {
        if (!entries || entries.length === 0) return 0;
        const totalDistance = entries.reduce((sum, entry) => sum + (entry.mainTankDistance ?? entry.kmTraveled ?? 0), 0);
        const totalLitres = entries.reduce((sum, entry) => sum + entry.litres, 0);
        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const getEffectiveMileage = useCallback((entries) => {
        if (!entries || entries.length === 0) {
            return { mileage: 0, source: 'none', isEstimated: false };
        }
        const lastEntry = entries[0];
        const rollingAvg = calculateRollingAverage(entries);

        const lastTankDistance = lastEntry.mainTankDistance ?? lastEntry.kmTraveled ?? 0;
        const shouldUseFallback = lastTankDistance < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD;

        if (shouldUseFallback && rollingAvg > 0 && entries.length >= 2) {
            return {
                mileage: rollingAvg,
                source: 'rolling-average',
                isEstimated: true
            };
        }

        const lastTankMileage = lastEntry.mileage > 0
            ? parseFloat(lastEntry.mileage)
            : (lastEntry.litres > 0 && lastTankDistance > 0
                ? lastTankDistance / lastEntry.litres
                : 0);

        return {
            mileage: lastTankMileage,
            source: 'last-tank',
            isEstimated: false
        };
    }, [calculateRollingAverage]);

    // ==========================================
    // GPS & DISTANCE HELPERS
    // ==========================================

    const toRad = useCallback((degrees) => {
        return degrees * (Math.PI / 180);
    }, []);

    const calculateDistance = useCallback((lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }, [toRad]);

    const showGpsMessage = useCallback((message, isError = false) => {
        setGpsMessage(message);
        setShowGpsAlert(true);
        if (!isError) {
            setTimeout(() => {
                setShowGpsAlert(false);
            }, 3000);
        }
    }, []);

    const _startEstimationTimer = (lossTime) => {
        if (estimationTimerRef.current) {
            clearInterval(estimationTimerRef.current);
        }
        estimationTimerRef.current = setInterval(() => {
            const elapsedMs = Date.now() - lossTime;
            const elapsedSec = elapsedMs / 1000;
            if (elapsedSec > 300) {
                // Cap at 5 minutes
                clearInterval(estimationTimerRef.current);
                estimationTimerRef.current = null;
                return;
            }
            const gapDist = (lastKnownSpeedRef.current * elapsedSec) / 1000;
            setEstimatedDistance(gapDist);
            estimatedDistanceRef.current = gapDist;
            setHasEstimatedSegment(true);
        }, 5000);
    };

    const handleGPSError = useCallback((error) => {
        console.error('GPS Error:', error);
        let message = '';
        let status = 'Error';

        if (isTracking) {
            if (error.code === error.TIMEOUT) {
                consecutiveTimeoutsRef.current += 1;
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                consecutiveTimeoutsRef.current = 2; // immediately trigger
            }

            if (error.code === error.POSITION_UNAVAILABLE || consecutiveTimeoutsRef.current >= 2) {
                if (lastKnownSpeedRef.current > 0) {
                    setGpsSignalLost(true);
                    setSignalLostAt(prev => {
                        if (!prev) {
                            const now = Date.now();
                            _startEstimationTimer(now);
                            return now;
                        }
                        return prev;
                    });
                    setGpsDebug(prev => ({ ...prev, status: 'Signal Lost' }));
                    showGpsMessage(`📡 GPS Signal Lost — estimating distance using last known speed ${(lastKnownSpeedRef.current * 3.6).toFixed(1)} km/h`, true);
                    return;
                } else {
                    setGpsDebug(prev => ({ ...prev, status: 'No Signal' }));
                    showGpsMessage('⚠️ GPS lost — speed unknown, cannot estimate distance.', true);
                    return;
                }
            }
        }

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '❌ GPS Permission Denied\n\nGo to Settings → Site Settings → Location';
                status = 'Permission Denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '📡 No GPS Signal\n\n• Move outdoors\n• Check if Location is ON';
                status = 'No Signal';
                break;
            case error.TIMEOUT:
                message = '⏱️ GPS Timeout - Retrying...';
                status = 'Searching...';
                setGpsDebug(prev => ({ ...prev, status }));
                return;
            default:
                message = '⚠️ GPS Error: ' + error.message;
                status = 'Error';
        }

        setGpsDebug(prev => ({ ...prev, status }));
        showGpsMessage(message, true);
    }, [isTracking, showGpsMessage]);

    const handlePositionUpdate = useCallback((position) => {
        positionCountRef.current += 1;
        const updateNum = positionCountRef.current;
        const accuracy = position.coords.accuracy;

        // GPS accuracy guard: wait until 5 meters or better
        if (accuracy > 5.0) {
            setGpsDebug(prev => ({
                ...prev,
                updates: updateNum,
                accuracy: accuracy,
                status: `Waiting for GPS lock... (${accuracy.toFixed(0)}m)`
            }));
            return;
        }

        const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: accuracy,
            speed: position.coords.speed || 0,
            timestamp: Date.now()
        };

        // Maintain last 2-3 positions in recentPositionsRef for fallback calculation
        recentPositionsRef.current.push(newPosition);
        if (recentPositionsRef.current.length > 3) {
            recentPositionsRef.current.shift();
        }

        let speed = position.coords.speed;
        if ((speed === null || speed === undefined || speed < 0) && recentPositionsRef.current.length >= 2) {
            const prevPos = recentPositionsRef.current[recentPositionsRef.current.length - 2];
            const distKm = calculateDistance(prevPos.lat, prevPos.lng, newPosition.lat, newPosition.lng);
            const timeDiffSec = (newPosition.timestamp - prevPos.timestamp) / 1000;
            if (timeDiffSec > 0) {
                speed = (distKm * 1000) / timeDiffSec; // m/s
            }
        }

        if (speed !== null && speed !== undefined && speed >= 0) {
            setLastKnownSpeed(speed);
            lastKnownSpeedRef.current = speed;
        }

        // Check if reconnecting from signal loss
        if (gpsSignalLost) {
            if (estimationTimerRef.current) {
                clearInterval(estimationTimerRef.current);
                estimationTimerRef.current = null;
            }

            setGpsSignalLost(false);
            const addedDist = estimatedDistanceRef.current;
            if (addedDist > 0) {
                setTotalEstimatedKm(prev => prev + addedDist);
                setHasEstimatedSegment(true);
                setCurrentTrip(prev => {
                    if (!prev) return prev;
                    return { ...prev, distance: prev.distance + addedDist };
                });
                setTotalKmSinceLastFill(prev => prev + addedDist);
                showGpsMessage(`✅ GPS reconnected — added ~${addedDist.toFixed(2)} km estimated during signal loss`, false);
            }

            setEstimatedDistance(0);
            estimatedDistanceRef.current = 0;
            consecutiveTimeoutsRef.current = 0;
            setSignalLostAt(null);

            // Resume normal GPS tracking from new position (no jump)
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            setSmoothSpeed(speed * 3.6);
            return;
        }

        setGpsDebug({
            updates: updateNum,
            lastLat: position.coords.latitude,
            lastLng: position.coords.longitude,
            accuracy: accuracy,
            speed: speed || 0,
            status: 'Active ✔',
            lastDistance: 0
        });

        if (isFirstPositionAfterStart.current) {
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            isFirstPositionAfterStart.current = false;
            
            const tripType = isRideRef.current ? '🚖 Ride' : '🏍️ Personal';
            showGpsMessage(`🟢 GPS Active (${tripType} - High Accuracy)`, false);
            return;
        }

        if (lastPositionRef.current) {
            const distance = calculateDistance(
                lastPositionRef.current.lat,
                lastPositionRef.current.lng,
                newPosition.lat,
                newPosition.lng
            );
            const distanceMeters = distance * 1000;
            let shouldUpdate = false;

            if (distanceMeters < 3) {
                shouldUpdate = false;
            } else if (accuracy > 100000) {
                shouldUpdate = false;
            } else if (speed !== null && speed < 0.5) {
                shouldUpdate = distanceMeters >= 2;
            } else if (positionHistoryRef.current.length >= 3) {
                let totalDistance = 0;
                for (let i = 1; i < positionHistoryRef.current.length; i++) {
                    const prev = positionHistoryRef.current[i - 1];
                    const curr = positionHistoryRef.current[i];
                    totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) * 1000;
                }
                shouldUpdate = totalDistance > 2 || distanceMeters > 2;
            } else if (distanceMeters > 2) {
                shouldUpdate = true;
            } else {
                shouldUpdate = false;
            }

            if (shouldUpdate) {
                setCurrentTrip(prev => {
                    if (!prev) return prev;
                    return { ...prev, distance: prev.distance + distance };
                });
                setTotalKmSinceLastFill(prev => prev + distance);
                setGpsDebug(prev => ({ ...prev, lastDistance: distanceMeters }));
                lastPositionRef.current = newPosition;
                positionHistoryRef.current = [newPosition];
            } else {
                setGpsDebug(prev => ({ ...prev, lastDistance: 0 }));
            }
        } else {
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
        }
    }, [calculateDistance, gpsSignalLost, showGpsMessage]);

    const stopTrip = useCallback(() => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        if (currentTrip) {
            let actualKm = currentTrip.distance;
            let finalHasEst = hasEstimatedSegment;
            let finalEstKm = totalEstimatedKm;

            if (gpsSignalLost && estimatedDistanceRef.current > 0) {
                const added = estimatedDistanceRef.current;
                actualKm += added;
                finalHasEst = true;
                finalEstKm += added;

                setTotalEstimatedKm(prev => prev + added);
                setHasEstimatedSegment(true);
                setTotalKmSinceLastFill(prev => prev + added);
            }

            // Always clear timer
            if (estimationTimerRef.current) {
                clearInterval(estimationTimerRef.current);
                estimationTimerRef.current = null;
            }
            setGpsSignalLost(false);
            setEstimatedDistance(0);
            estimatedDistanceRef.current = 0;
            setSignalLostAt(null);
            consecutiveTimeoutsRef.current = 0;

            if (currentTrip.isRide) {
                setCompletedRideKm(actualKm);
                setShowRideCompletionDialog(true);
                setIsTracking(false);
                setGpsDebug(prev => ({ ...prev, status: 'Stopped', speed: 0 }));
            } else {
                const completedTrip = {
                    ...currentTrip,
                    distance: actualKm,
                    endTime: new Date().toISOString(),
                    isActive: false,
                    hasEstimatedSegment: finalHasEst,
                    estimatedKm: finalEstKm
                };
                setTrips(prev => [...prev, completedTrip]);
                setCurrentTrip(null);
                setIsTracking(false);
                setGpsDebug(prev => ({ ...prev, status: 'Stopped', speed: 0 }));
                showGpsMessage('⏸️ Personal Trip Stopped', false);
            }
        }

        lastPositionRef.current = null;
        positionCountRef.current = 0;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;
    }, [currentTrip, gpsSignalLost, hasEstimatedSegment, totalEstimatedKm, showGpsMessage]);

    // ==========================================
    // SMOOTH SPEED ANIMATION
    // ==========================================

    useEffect(() => {
        if (!isTracking) {
            const interval = setInterval(() => {
                setSmoothSpeed(prev => {
                    if (prev < 0.5) {
                        clearInterval(interval);
                        return 0;
                    }
                    return prev * 0.9;
                });
            }, 50);
            return () => clearInterval(interval);
        }

        let animationFrameId;
        let isActive = true;
        const targetSpeed = gpsDebug.speed * 3.6; // convert m/s to km/h

        const animate = () => {
            if (!isActive) return;
            setSmoothSpeed(prev => {
                const diff = targetSpeed - prev;
                if (Math.abs(diff) < 0.05) {
                    return targetSpeed;
                }
                return prev + (diff * 0.06);
            });
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            isActive = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [gpsDebug.speed, isTracking]);

    // ==========================================
    // DATA PERSISTENCE
    // ==========================================

    useEffect(() => {
        const loadData = () => {
            try {
                const stored = localStorage.getItem('petrolTrackerData');
                if (stored) {
                    const data = JSON.parse(stored);
                    setPetrolEntries(data.petrolEntries || []);
                    setTrips(data.trips || []);
                    setCurrentTrip(data.currentTrip || null);
                    setTotalKmSinceLastFill(data.totalKmSinceLastFill || 0);

                    // Clear ride data from previous months automatically
                    const nowMonth = new Date().getMonth();
                    const nowYear = new Date().getFullYear();
                    const filteredRides = (data.rideEntries || []).filter(r => {
                        const d = new Date(r.date);
                        return d.getMonth() === nowMonth && d.getFullYear() === nowYear;
                    });
                    setRideEntries(filteredRides);

                    // Load reserve tracking states
                    setReserveActive(data.reserveActive || false);
                    setReserveStartDistance(data.reserveStartDistance || 0);
                    setManualReserveDistance(data.manualReserveDistance || 0);
                }
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };

        loadData();
    }, []);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        const timeoutId = setTimeout(() => {
            try {
                const data = {
                    petrolEntries,
                    trips,
                    currentTrip,
                    totalKmSinceLastFill,
                    rideEntries,
                    reserveActive,
                    reserveStartDistance,
                    manualReserveDistance,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem('petrolTrackerData', JSON.stringify(data));
            } catch (error) {
                if (error.name === 'QuotaExceededError') {
                    const trimmedData = {
                        petrolEntries: petrolEntries.slice(0, 20),
                        trips: trips.slice(0, 50),
                        currentTrip,
                        totalKmSinceLastFill,
                        rideEntries: rideEntries.slice(0, 50),
                        reserveActive,
                        reserveStartDistance,
                        manualReserveDistance,
                        lastSaved: new Date().toISOString()
                    };
                    localStorage.setItem('petrolTrackerData', JSON.stringify(trimmedData));
                    alert('⚠️ Storage full! Trimmed old data');
                } else {
                    console.error('Storage error:', error);
                }
            }
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [petrolEntries, trips, currentTrip, totalKmSinceLastFill, rideEntries, reserveActive, reserveStartDistance, manualReserveDistance]);

    // ==========================================
    // PWA INSTALL PROMPT
    // ==========================================

    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setCanInstall(true);
            setShowInstallPrompt(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {
            setShowInstallPrompt(false);
            setCanInstall(false);
        }

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    // ==========================================
    // PREVENT ACCIDENTAL BACK DURING TRACKING
    // ==========================================

    useEffect(() => {
        const handleBackButton = () => {
            if (isTracking) {
                const confirmStop = window.confirm('⚠️ Trip is running!\n\nStop trip and go back?');
                if (confirmStop) {
                    stopTrip();
                } else {
                    window.history.pushState(null, '', window.location.pathname);
                }
            }
        };

        if (isTracking) {
            window.history.pushState(null, '', window.location.pathname);
            window.addEventListener('popstate', handleBackButton);
        }

        return () => window.removeEventListener('popstate', handleBackButton);
    }, [isTracking, stopTrip]);

    // ==========================================
    // RESET DATA
    // ==========================================

    const handleResetRequest = () => {
        setShowResetConfirm(true);
    };

    const confirmReset = () => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        // Reset signal loss and estimation state
        setGpsSignalLost(false);
        setLastKnownSpeed(0);
        lastKnownSpeedRef.current = 0;
        setEstimatedDistance(0);
        estimatedDistanceRef.current = 0;
        setTotalEstimatedKm(0);
        setHasEstimatedSegment(false);
        setSignalLostAt(null);
        consecutiveTimeoutsRef.current = 0;
        recentPositionsRef.current = [];
        if (estimationTimerRef.current) {
            clearInterval(estimationTimerRef.current);
            estimationTimerRef.current = null;
        }

        setPetrolEntries([]);
        setTrips([]);
        setCurrentTrip(null);
        setTotalKmSinceLastFill(0);
        setRideEntries([]);
        setLitres('');
        setPricePerLitre('');
        setFillDate(new Date().toISOString().split('T')[0]);
        setIsTracking(false);
        lastPositionRef.current = null;
        positionCountRef.current = 0;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;

        setGpsDebug({
            updates: 0,
            lastLat: 0,
            lastLng: 0,
            accuracy: 0,
            speed: 0,
            status: 'Not started',
            lastDistance: 0
        });

        localStorage.removeItem('petrolTrackerData');
        setShowResetConfirm(false);
        setActiveScreen('dashboard');
        alert('✅ All data reset!');
    };

    const cancelReset = () => {
        setShowResetConfirm(false);
    };

    const handleInstallClick = async () => {
        if (!deferredPrompt) {
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                alert('To install:\n\n1. Tap Share button\n2. Tap "Add to Home Screen"\n3. Tap "Add"');
                return;
            }
            alert('Install option not available. Try Chrome or Safari.');
            return;
        }

        const promptEvent = deferredPrompt;
        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
            setShowInstallPrompt(false);
            setCanInstall(false);
        }
        setDeferredPrompt(null);
    };

    // ==========================================
    // EXPORT DATA
    // ==========================================

    const exportData = () => {
        const data = {
            petrolEntries,
            trips,
            rideEntries,
            totalKmSinceLastFill,
            reserveActive,
            reserveStartDistance,
            manualReserveDistance,
            fallbackReserveDistance,
            exportDate: new Date().toISOString(),
            appVersion: '2.0'
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `petrol-tracker-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('✅ Data exported successfully!');
    };

    // ==========================================
    // PETROL ENTRY
    // ==========================================

    const savePetrolEntry = () => {
        const litresNum = parseFloat(litres);
        const priceNum = parseFloat(pricePerLitre);

        if (isNaN(litresNum) || !isFinite(litresNum) || litresNum <= 0) {
            alert('❌ Please enter valid litres!');
            return;
        }

        if (isNaN(priceNum) || !isFinite(priceNum) || priceNum <= 0) {
            alert('❌ Please enter valid price!');
            return;
        }

        if (!fillDate) {
            alert('❌ Please select a date!');
            return;
        }

        const roundedLitres = Math.round(litresNum * 100) / 100;
        const roundedPrice = Math.round(priceNum * 100) / 100;

        let liveReserve = reserveActive ? (totalKmSinceLastFill - reserveStartDistance) : 0;
        let fallback = parseFloat(fallbackReserveDistance);
        if (isNaN(fallback) || fallback < 0) fallback = 0;
        
        let calculatedReserve = liveReserve + manualReserveDistance + fallback;
        if (calculatedReserve > totalKmSinceLastFill) {
            calculatedReserve = totalKmSinceLastFill;
        }
        
        let mainTankDistance = totalKmSinceLastFill - calculatedReserve;

        const tankMileage = mainTankDistance > 0
            ? (mainTankDistance / roundedLitres).toFixed(2)
            : 0;

        const isShortTank = mainTankDistance < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD && mainTankDistance > 0;

        const entry = {
            id: Date.now(),
            litres: roundedLitres,
            pricePerLitre: roundedPrice,
            totalCost: roundedLitres * roundedPrice,
            date: fillDate,
            kmTraveled: totalKmSinceLastFill,
            mainTankDistance: mainTankDistance,
            reserveDistance: calculatedReserve,
            mileage: tankMileage,
            isEstimated: isShortTank,
            createdAt: new Date().toISOString()
        };

        setPetrolEntries(prev => [entry, ...prev]);
        setTotalKmSinceLastFill(0);
        setTrips([]);
        setLitres('');
        setPricePerLitre('');
        setFillDate(new Date().toISOString().split('T')[0]);
        setReserveActive(false);
        setReserveStartDistance(0);
        setManualReserveDistance(0);
        setFallbackReserveDistance('');

        if (isShortTank) {
            const rollingAvg = calculateRollingAverage([entry, ...petrolEntries]);
            alert(`⚠️ Short tank detected (${totalKmSinceLastFill.toFixed(1)} km)\n\n` +
                `Tank mileage: ${tankMileage} km/L (estimated)\n` +
                (rollingAvg > 0 ? `Using 5-fill average (${rollingAvg.toFixed(2)} km/L) for calculations.\n\n` : '\n') +
                `✅ Entry saved!`);
        } else {
            alert('✅ Petrol entry saved!');
        }

        setActiveScreen('dashboard');
    };

    // ==========================================
    // MANUAL KM ENTRY
    // ==========================================


    const saveManualKm = () => {
        const kmNum = parseFloat(manualKm);
        if (isNaN(kmNum) || !isFinite(kmNum) || kmNum <= 0) {
            alert('❌ Please enter valid kilometers!');
            return;
        }

        if (kmNum > 1000) {
            const confirmed = window.confirm('⚠️ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
            if (!confirmed) return;
        }

        const roundedKm = Math.round(kmNum * 100) / 100;
        setTotalKmSinceLastFill(prev => prev + roundedKm);

        const manualTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            distance: roundedKm,
            isActive: false,
            isManual: true
        };

        setTrips(prev => [...prev, manualTrip]);
        setManualKm('');
        setShowManualEntry(false);
        alert('✅ ' + roundedKm + ' km added!');
    };

    const cancelManualEntry = () => {
        setManualKm('');
        setShowManualEntry(false);
    };

    // ==========================================
    // MANUAL RESERVE ENTRY
    // ==========================================

    const saveAddReserve = () => {
        const kmNum = parseFloat(addReserveInput);
        if (isNaN(kmNum) || !isFinite(kmNum) || kmNum <= 0) {
            alert('❌ Please enter valid kilometers!');
            return;
        }

        const roundedKm = Math.round(kmNum * 100) / 100;
        setManualReserveDistance(prev => prev + roundedKm);
        setAddReserveInput('');
        setShowAddReserveModal(false);
        alert('✅ ' + roundedKm + ' km added to Reserve!');
    };

    const cancelAddReserve = () => {
        setAddReserveInput('');
        setShowAddReserveModal(false);
    };

    // ==========================================
    // RIDE ENTRY (MANUAL)
    // ==========================================


    const saveRideEntry = () => {
        const kmNum = parseFloat(rideKm);
        const earningsNum = parseFloat(rideEarnings);
        const tipNum = parseFloat(rideTip) || 0;

        if (isNaN(kmNum) || !isFinite(kmNum) || kmNum <= 0) {
            alert('❌ Please enter valid kilometers!');
            return;
        }

        if (isNaN(earningsNum) || !isFinite(earningsNum) || earningsNum < 0) {
            alert('❌ Please enter valid earnings!');
            return;
        }

        if (kmNum > 500) {
            const confirmed = window.confirm('⚠️ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
            if (!confirmed) return;
        }

        const roundedKm = Math.round(kmNum * 100) / 100;
        const roundedEarnings = Math.round(earningsNum * 100) / 100;
        const roundedTip = Math.round(tipNum * 100) / 100;

        const effectiveMileageData = getEffectiveMileage(petrolEntries);
        let costPerKm = 0;
        let fuelUsed = 0;
        let fuelCost = 0;

        if (petrolEntries.length > 0 && effectiveMileageData.mileage > 0) {
            const lastEntry = petrolEntries[0];
            fuelUsed = roundedKm / effectiveMileageData.mileage;
            fuelCost = fuelUsed * lastEntry.pricePerLitre;
            costPerKm = lastEntry.pricePerLitre / effectiveMileageData.mileage;
        }

        const totalEarnings = roundedEarnings + roundedTip;
        const profit = totalEarnings - fuelCost;
        const profitPerKm = roundedKm > 0 ? profit / roundedKm : 0;

        const rideEntry = {
            id: Date.now(),
            date: new Date().toISOString(),
            km: roundedKm,
            earnings: roundedEarnings,
            tip: roundedTip,
            totalEarnings: totalEarnings,
            fuelUsed: fuelUsed,
            fuelCost: fuelCost,
            profit: profit,
            profitPerKm: profitPerKm,
            costPerKm: costPerKm,
            mileageUsed: effectiveMileageData.mileage,
            mileageSource: effectiveMileageData.source
        };

        setRideEntries(prev => [rideEntry, ...prev]);
        setTotalKmSinceLastFill(prev => prev + roundedKm);

        const rideTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            distance: roundedKm,
            isActive: false,
            isRide: true,
            earnings: totalEarnings
        };

        setTrips(prev => [...prev, rideTrip]);

        setRideKm('');
        setRideEarnings('');
        setRideTip('');
        setShowRideEntry(false);

        const mileageInfo = effectiveMileageData.isEstimated
            ? `(using 5-fill avg: ${effectiveMileageData.mileage.toFixed(2)} km/L)`
            : `(using current tank: ${effectiveMileageData.mileage.toFixed(2)} km/L)`;

        alert(`✅ Ride Saved!\n\n` +
            `Distance: ${roundedKm} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip} 🎁\n` : '') +
            `Total Earnings: Rs. ${totalEarnings.toFixed(2)}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L ${mileageInfo}\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💰 Profit: Rs. ${profit.toFixed(2)}\n` +
            `Per KM: Rs. ${profitPerKm.toFixed(2)}/km`
        );
    };

    const cancelRideEntry = () => {
        setRideKm('');
        setRideEarnings('');
        setRideTip('');
        setShowRideEntry(false);
    };

    // ==========================================
    // FARE CALCULATOR
    // ==========================================

    const calculateFare = () => {
        const km = parseFloat(calcKm);
        const offerPrice = parseFloat(calcOffer);
        const myPrice = parseFloat(calcMyPrice);

        if (isNaN(km) || km <= 0) {
            alert('❌ Enter valid kilometers!');
            return;
        }

        if (isNaN(offerPrice) || offerPrice < 0) {
            alert('❌ Enter valid offer price!');
            return;
        }

        const effectiveMileageData = getEffectiveMileage(petrolEntries);
        let costPerKm = 0;
        let fuelUsed = 0;
        let fuelCost = 0;

        if (petrolEntries.length > 0 && effectiveMileageData.mileage > 0) {
            const lastEntry = petrolEntries[0];
            fuelUsed = km / effectiveMileageData.mileage;
            fuelCost = fuelUsed * lastEntry.pricePerLitre;
            costPerKm = lastEntry.pricePerLitre / effectiveMileageData.mileage;
        } else {
            // Fallback operating cost in PKR per km if no fuel log exists
            costPerKm = 15;
            fuelCost = km * costPerKm;
        }

        const offerProfit = offerPrice - fuelCost;
        const offerProfitPerKm = km > 0 ? offerProfit / km : 0;

        let myProfit = 0;
        let myProfitPerKm = 0;
        let priceDifference = 0;
        let profitDifference = 0;

        if (!isNaN(myPrice) && myPrice > 0) {
            myProfit = myPrice - fuelCost;
            myProfitPerKm = km > 0 ? myProfit / km : 0;
            priceDifference = myPrice - offerPrice;
            profitDifference = myProfit - offerProfit;
        }

        setCalculationResult({
            km: km,
            fuelUsed: fuelUsed,
            fuelCost: fuelCost,
            costPerKm: costPerKm,
            offerPrice: offerPrice,
            offerProfit: offerProfit,
            offerProfitPerKm: offerProfitPerKm,
            myPrice: myPrice,
            myProfit: myProfit,
            myProfitPerKm: myProfitPerKm,
            priceDifference: priceDifference,
            profitDifference: profitDifference,
            mileageSource: effectiveMileageData.source,
            mileageValue: effectiveMileageData.mileage,
            isEstimated: effectiveMileageData.isEstimated
        });
    };

    const clearCalculator = () => {
        setCalcKm('');
        setCalcOffer('');
        setCalcMyPrice('');
        setCalculationResult(null);
    };

    // ==========================================
    // GPS TRACKING START
    // ==========================================

    const startGPSTracking = (isRideTrip = false) => {
        if (!navigator.geolocation) {
            alert('❌ GPS not supported');
            return;
        }

        if (watchIdRef.current) {
            console.warn('Trip already in progress');
            return;
        }

        // Reset signal loss and estimation state
        setGpsSignalLost(false);
        setLastKnownSpeed(0);
        lastKnownSpeedRef.current = 0;
        setEstimatedDistance(0);
        estimatedDistanceRef.current = 0;
        setTotalEstimatedKm(0);
        setHasEstimatedSegment(false);
        setSignalLostAt(null);
        consecutiveTimeoutsRef.current = 0;
        recentPositionsRef.current = [];
        isRideRef.current = isRideTrip;
        if (estimationTimerRef.current) {
            clearInterval(estimationTimerRef.current);
            estimationTimerRef.current = null;
        }

        positionCountRef.current = 0;
        lastPositionRef.current = null;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;

        setGpsDebug(prev => ({ ...prev, status: 'Getting GPS lock...' }));

        const newTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            distance: 0,
            isActive: true,
            isRide: isRideTrip
        };

        setCurrentTrip(newTrip);
        setIsTracking(true);

        const startWatching = (highAccuracy) => {
            const options = {
                enableHighAccuracy: highAccuracy,
                timeout: 30000,
                maximumAge: highAccuracy ? 5000 : 10000
            };

            watchIdRef.current = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handleGPSError,
                options
            );

            showGpsMessage('📡 Waiting for accurate GPS signal (≤5 m)...', false);
            setGpsDebug(prev => ({ ...prev, status: 'Waiting for GPS lock...' }));
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                startWatching(true);
            },
            (error) => {
                if (error.code === 3) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            startWatching(false);
                        },
                        (retryError) => {
                            handleGPSError(retryError);
                            setIsTracking(false);
                            setCurrentTrip(null);
                            alert('❌ GPS Failed\n\nEnable Location & go outdoors');
                        },
                        {
                            enableHighAccuracy: false,
                            timeout: 30000,
                            maximumAge: 10000
                        }
                    );
                } else {
                    handleGPSError(error);
                    setIsTracking(false);
                    setCurrentTrip(null);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    };

    const completeRideWithEarnings = () => {
        const earningsNum = parseFloat(rideEarnings);
        const tipNum = parseFloat(rideTip) || 0;

        if (isNaN(earningsNum) || !isFinite(earningsNum) || earningsNum < 0) {
            alert('❌ Please enter valid earnings!');
            return;
        }

        const roundedEarnings = Math.round(earningsNum * 100) / 100;
        const roundedTip = Math.round(tipNum * 100) / 100;
        const actualKm = completedRideKm;

        const effectiveMileageData = getEffectiveMileage(petrolEntries);
        let costPerKm = 0;
        let fuelUsed = 0;
        let fuelCost = 0;

        if (petrolEntries.length > 0 && effectiveMileageData.mileage > 0) {
            const lastEntry = petrolEntries[0];
            fuelUsed = actualKm / effectiveMileageData.mileage;
            fuelCost = fuelUsed * lastEntry.pricePerLitre;
            costPerKm = lastEntry.pricePerLitre / effectiveMileageData.mileage;
        }

        const totalEarnings = roundedEarnings + roundedTip;
        const profit = totalEarnings - fuelCost;
        const profitPerKm = actualKm > 0 ? profit / actualKm : 0;

        const rideEntry = {
            id: Date.now(),
            date: new Date().toISOString(),
            km: actualKm,
            earnings: roundedEarnings,
            tip: roundedTip,
            totalEarnings: totalEarnings,
            fuelUsed: fuelUsed,
            fuelCost: fuelCost,
            profit: profit,
            profitPerKm: profitPerKm,
            costPerKm: costPerKm,
            mileageUsed: effectiveMileageData.mileage,
            mileageSource: effectiveMileageData.source
        };

        setRideEntries(prev => [rideEntry, ...prev]);

        const completedTrip = {
            ...currentTrip,
            endTime: new Date().toISOString(),
            isActive: false,
            earnings: totalEarnings
        };

        setTrips(prev => [...prev, completedTrip]);
        setCurrentTrip(null);

        setRideEarnings('');
        setRideTip('');
        setShowRideCompletionDialog(false);
        setCompletedRideKm(0);

        const mileageInfo = effectiveMileageData.isEstimated
            ? `(using 5-fill avg: ${effectiveMileageData.mileage.toFixed(2)} km/L)`
            : `(using current tank: ${effectiveMileageData.mileage.toFixed(2)} km/L)`;

        alert(`✅ Ride Completed!\n\n` +
            `Distance: ${actualKm.toFixed(2)} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip} 🎁\n` : '') +
            `Total Earnings: Rs. ${totalEarnings.toFixed(2)}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L ${mileageInfo}\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💰 Net Profit: Rs. ${profit.toFixed(2)}\n` +
            `Per KM: Rs. ${profitPerKm.toFixed(2)}/km`
        );
    };

    const cancelRideCompletion = () => {
        const completedTrip = {
            ...currentTrip,
            endTime: new Date().toISOString(),
            isActive: false
        };

        setTrips(prev => [...prev, completedTrip]);
        setCurrentTrip(null);
        setRideEarnings('');
        setRideTip('');
        setShowRideCompletionDialog(false);
        setCompletedRideKm(0);
    };

    // ==========================================
    // SUMMARY CALCULATIONS (MEMOIZED)
    // ==========================================

    const getMonthlySummary = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalLitres = 0;
        let totalSpent = 0;
        let totalKm = 0;

        petrolEntries.forEach(entry => {
            const entryDate = new Date(entry.date);
            if (entryDate.getMonth() === currentMonth &&
                entryDate.getFullYear() === currentYear) {
                totalLitres += entry.litres;
                totalSpent += entry.totalCost;
                if (entry.kmTraveled > 0) {
                    totalKm += entry.kmTraveled;
                }
            }
        });

        if (totalKmSinceLastFill > 0) {
            totalKm += totalKmSinceLastFill;
        }

        const avgMileage = totalLitres > 0 ? (totalKm / totalLitres).toFixed(2) : '0';
        return { totalLitres, totalSpent, totalKm, avgMileage };
    }, [petrolEntries, totalKmSinceLastFill]);

    const getRideSummary = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalRides = 0;
        let totalRideKm = 0;
        let totalEarnings = 0;
        let totalTips = 0;
        let totalFuelCost = 0;
        let totalProfit = 0;

        rideEntries.forEach(ride => {
            const rideDate = new Date(ride.date);
            if (rideDate.getMonth() === currentMonth &&
                rideDate.getFullYear() === currentYear) {
                totalRides++;
                totalRideKm += ride.km;
                totalEarnings += ride.totalEarnings;
                totalTips += ride.tip || 0;
                totalFuelCost += ride.fuelCost;
                totalProfit += ride.profit;
            }
        });

        const avgProfitPerRide = totalRides > 0 ? totalProfit / totalRides : 0;
        const avgProfitPerKm = totalRideKm > 0 ? totalProfit / totalRideKm : 0;

        return {
            totalRides,
            totalRideKm,
            totalEarnings,
            totalTips,
            totalFuelCost,
            totalProfit,
            avgProfitPerRide,
            avgProfitPerKm
        };
    }, [rideEntries]);

    // ==========================================
    // SCREEN RENDERS
    // ==========================================

    const renderDashboard = () => {
        const monthly = getMonthlySummary;
        const lastEntry = petrolEntries[0];
        const effectiveMileageData = getEffectiveMileage(petrolEntries);

        const getMileageTrend = () => {
            if (petrolEntries.length < 2) return null;
            const current = parseFloat(petrolEntries[0].mileage) || 0;
            const previous = parseFloat(petrolEntries[1].mileage) || 0;
            return current - previous;
        };
        const trend = getMileageTrend();

        const rollingAvgVal = calculateRollingAverage(petrolEntries) || 0;
        const maxExpectedRollingMileage = 30;
        const rollingAvgPercent = Math.min(100, Math.max(0, (rollingAvgVal / maxExpectedRollingMileage) * 100));

        // Arc gauge math: circumference of r=46 circle ≈ 289
        const maxMileage = 60;
        const currentMileage = effectiveMileageData.mileage > 0 ? effectiveMileageData.mileage : 0;
        const gaugeFill = Math.min(1, currentMileage / maxMileage);
        const circumference = 2 * Math.PI * 46;
        const dashArray = `${(gaugeFill * circumference).toFixed(1)} ${circumference.toFixed(1)}`;

        return (
            <div className="space-y-xl max-w-md mx-auto pb-8">

                {/* Top App Bar */}
                <header className="w-full pt-6 flex justify-between items-center">
                    <div className="flex flex-col">
                        <h1 className="font-headline-lg text-headline-lg text-primary leading-tight">Fuel &amp; Ride</h1>
                        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-[0.2em]">Track fuel efficiency</p>
                    </div>
                    <div className="flex items-center gap-md">
                        <button
                            className="material-symbols-outlined text-primary hover:opacity-80 transition-opacity active:scale-95"
                            onClick={() => alert('No new notifications')}
                            title="Notifications"
                        >
                            notifications
                        </button>
                        <div
                            className="w-10 h-10 rounded-full border-2 border-primary/30 p-0.5 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => alert('Driver Profile: App settings are managed below.')}
                            title="Driver Profile"
                        >
                            <img
                                alt="Profile"
                                className="w-full h-full object-cover rounded-full"
                                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAwjmFtRgSpk1FHcfwSzh1upW-FdfiZxkquEY3hblRuGLQHvpX6iOH1a87ByqehaB4oh0gYD9TpGI6w8XqSMJa7vevEUbcqqz9UInqmDAMFA4wqc0bi7FmqaJVDKOcDX30-Siydmy8JdhZsaY5J9OzxaSg3hs0CnzAHaSvO8z1hfYe_tSbrJ0o0ZzcJH-PFsb1HLHhI6UzPtkOqSb4TTerRonLEQy6vLyNjmqR1K7ZBoiPqb6yhenLpmA"
                            />
                        </div>
                    </div>
                </header>

                {/* Install App Banner */}
                {showInstallPrompt && canInstall && (
                    <section className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-500">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg fuel-active-gradient flex items-center justify-center text-on-primary">
                                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>install_mobile</span>
                            </div>
                            <div>
                                <h3 className="font-label-caps text-label-caps text-on-surface">Experience it natively</h3>
                                <p className="text-[11px] text-on-surface-variant">Add to home screen for quick access</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                className="font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors active:scale-95"
                                onClick={() => setShowInstallPrompt(false)}
                            >
                                Later
                            </button>
                            <button
                                className="fuel-active-gradient px-4 py-2 rounded-full font-label-caps text-label-caps text-on-primary context-glow-primary hover:opacity-90 active:scale-90"
                                onClick={handleInstallClick}
                            >
                                Install
                            </button>
                        </div>
                    </section>
                )}

                {/* ── Current Tank Hero Section ── */}
                <section className="relative pt-lg overflow-visible">
                    <div className="absolute -top-10 -left-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>

                    <div className="flex flex-col items-center">
                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-md">Current Tank</span>

                        {/* Arc Gauge */}
                        <div className="relative w-72 h-72 mx-auto flex items-center justify-center rounded-full bg-surface-container-lowest border border-primary/10 shadow-[0_0_60px_rgba(75,223,159,0.1)] glow-mint shadow-2xl">
                            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                                {currentMileage > 0 && (
                                    <circle
                                        cx="50" cy="50" r="46" fill="none"
                                        stroke="url(#gaugeGrad)" strokeWidth="4"
                                        strokeLinecap="round"
                                        strokeDasharray={dashArray}
                                        style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.34,1.56,0.64,1)' }}
                                    />
                                )}
                                <defs>
                                    <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#6bfbb8" />
                                        <stop offset="100%" stopColor="#b8c4ff" />
                                    </linearGradient>
                                </defs>
                            </svg>

                            {/* Inner disc */}
                            <div className="relative w-[85%] h-[85%] rounded-full bg-gradient-to-br from-surface-container-high to-surface-container flex flex-col items-center justify-center border border-white/5 shadow-inner">
                                <div className="flex flex-col items-center justify-center">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant/60 uppercase tracking-widest mb-xs">Current Mileage</span>
                                    <div className="flex flex-col items-center justify-center">
                                        <h2 className="font-display-hero text-6xl text-primary drop-shadow-[0_0_15px_rgba(107,251,184,0.3)]">
                                            {currentMileage > 0 ? currentMileage.toFixed(1) : '0.0'}
                                        </h2>
                                        <span className="font-label-caps text-label-caps text-on-surface-variant">km/L</span>
                                    </div>
                                </div>
                                <div className="absolute inset-6 rounded-full border border-dashed border-primary/10 pointer-events-none"></div>
                            </div>

                            {/* Trend badge */}
                            {trend !== null ? (
                                <div className={`absolute -top-3 -right-3 px-3 py-1.5 rounded-full flex items-center gap-1 text-[11px] font-bold border backdrop-blur-sm ${
                                    trend >= 0
                                        ? 'bg-primary/10 border-primary/20 text-primary'
                                        : 'bg-error/10 border-error/20 text-error'
                                }`}>
                                    <span className="material-symbols-outlined text-[14px]">{trend >= 0 ? 'trending_up' : 'trending_down'}</span>
                                    {trend >= 0 ? '+' : ''}{trend.toFixed(1)}
                                </div>
                            ) : (
                                <div className="absolute -top-3 -right-3 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-bold text-on-surface-variant backdrop-blur-sm">
                                    First Fill
                                </div>
                            )}
                        </div>

                        {/* Asymmetric Litres & Distance Cards */}
                        <div className="flex w-full gap-md mt-xl">
                            <div className="glass-card p-md rounded-2xl flex-none w-[40%] border-l-4 border-l-primary/30 relative overflow-hidden group">
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <span className="block font-label-caps text-[10px] text-on-secondary-container mb-xs">Litres</span>
                                <span className="font-data-lg text-xl text-on-surface">
                                    {lastEntry ? `${lastEntry.litres.toFixed(2)} L` : '0.00 L'}
                                </span>
                            </div>
                            <div className="glass-card p-md rounded-2xl flex-1 border-r-4 border-r-secondary/30 relative overflow-hidden group">
                                <div className="absolute -right-4 -top-4 w-16 h-16 bg-secondary/5 rounded-full blur-xl pointer-events-none"></div>
                                <span className="block font-label-caps text-[10px] text-on-secondary-container mb-xs">Distance</span>
                                <span className="font-data-lg text-xl text-on-surface">
                                    {totalKmSinceLastFill.toFixed(1)} km
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Rolling Average ── */}
                <section className="space-y-sm">
                    <div className="flex justify-between items-end px-xs">
                        <span className="font-label-caps text-label-caps text-on-surface-variant">Rolling Average</span>
                        <span className="font-data-lg text-xl text-primary">{rollingAvgVal.toFixed(1)} km/L</span>
                    </div>
                    <div className="relative h-3 w-full bg-surface-container rounded-full overflow-visible">
                        <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-700"
                            style={{ width: `${rollingAvgPercent}%` }}
                        ></div>
                        {rollingAvgPercent > 2 && (
                            <div
                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full glow-mint transition-all duration-700"
                                style={{ left: `${rollingAvgPercent}%` }}
                            ></div>
                        )}
                    </div>
                </section>


                {/* ── This Month – Asymmetric Layout ── */}
                <section className="space-y-lg">
                    <div className="flex justify-between items-center">
                        <h3 className="font-headline-md text-headline-md text-on-surface">This Month</h3>
                        <button
                            className="font-label-caps text-label-caps text-primary hover:underline transition-all cursor-pointer"
                            onClick={() => setActiveScreen('history')}
                        >
                            View Report
                        </button>
                    </div>

                    <div className="flex flex-col gap-md">
                        {/* Row 1: 40/60 — Litres | Spent */}
                        <div className="flex gap-md h-24">
                            <div className="glass-card p-md rounded-2xl flex-none w-[40%] border-l-4 border-l-primary relative overflow-hidden kinetic-bg">
                                <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-6xl opacity-20 text-primary/10 pointer-events-none">opacity</span>
                                <div className="flex flex-col h-full justify-between relative z-10">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">Litres</span>
                                    <span className="font-data-lg text-headline-md text-on-surface">{monthly.totalLitres.toFixed(1)} L</span>
                                </div>
                            </div>
                            <div className="glass-card p-md rounded-2xl flex-none w-[60%] border-r-4 border-r-secondary text-right relative overflow-hidden bg-gradient-to-bl from-secondary/5 to-transparent">
                                <span className="material-symbols-outlined text-secondary opacity-5 absolute -left-2 -bottom-2 text-6xl pointer-events-none">payments</span>
                                <div className="absolute top-0 right-0 w-8 h-8 bg-secondary/10 blur-xl pointer-events-none"></div>
                                <div className="flex flex-col h-full justify-between relative z-10">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider">Spent</span>
                                    <div className="flex flex-col items-end">
                                        <span className="font-data-lg text-on-surface text-headline-md">
                                            PKR {monthly.totalSpent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                        </span>
                                        <span className="text-[10px] text-on-surface-variant/60 font-label-caps">Total</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Row 2: 60/40 — Distance | Avg Mileage */}
                        <div className="flex gap-md h-24">
                            <div className="glass-card p-md rounded-2xl flex-none w-[60%] border-l-4 border-l-primary relative overflow-hidden bg-gradient-to-tr from-primary/5 to-transparent">
                                <span className="material-symbols-outlined text-primary opacity-5 absolute -right-2 -top-2 text-6xl pointer-events-none">route</span>
                                <div className="flex flex-col h-full justify-between relative z-10">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">Distance</span>
                                    <span className="font-data-lg text-headline-md text-on-surface">{monthly.totalKm.toFixed(1)} km</span>
                                </div>
                            </div>
                            <div className="glass-card p-md rounded-2xl flex-none w-[40%] border-r-4 border-r-secondary text-right relative overflow-hidden kinetic-bg">
                                <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(1px 1px, rgba(184,196,255,0.2) 1%, transparent 1%)', backgroundSize: '10px 10px' }}></div>
                                <span className="material-symbols-outlined text-secondary opacity-5 absolute -left-2 -top-2 text-6xl pointer-events-none">trending_up</span>
                                <div className="flex flex-col h-full justify-between relative z-10">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">Avg Mileage</span>
                                    <span className="font-data-lg text-headline-md text-on-surface">{monthly.avgMileage} km/L</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Data Management ── */}
                <section className="flex flex-col gap-md pb-4">
                    <button
                        className="w-full py-md px-lg rounded-xl glass-card flex items-center justify-center gap-md border border-outline-variant hover:bg-surface-container transition-colors group cursor-pointer active:scale-95"
                        onClick={exportData}
                    >
                        <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">ios_share</span>
                        <span className="font-label-caps text-label-caps text-on-surface">Export Data (JSON)</span>
                    </button>
                    <button
                        className="w-full py-md px-lg rounded-xl glass-card flex items-center justify-center gap-md border border-error/30 hover:bg-error-container/10 transition-colors group cursor-pointer active:scale-95"
                        onClick={handleResetRequest}
                    >
                        <span className="material-symbols-outlined text-error">delete_sweep</span>
                        <span className="font-label-caps text-label-caps text-error">Reset All Data</span>
                    </button>
                </section>
            </div>
        );
    };

    const renderPetrolEntry = () => {

        const estTotal = (parseFloat(litres) || 0) * (parseFloat(pricePerLitre) || 0);
        const litrePercent = Math.min(((parseFloat(litres) || 0) / 60) * 100, 100);
        const litreGaugeDashoffset = 100 - litrePercent;

        return (
            <div className="w-full">
                {/* Background Decoration */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
                    <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]"></div>
                    <div className="absolute top-[40%] -right-[10%] w-[30%] h-[30%] bg-secondary/5 rounded-full blur-[100px]"></div>
                </div>



                <main className="pb-32 pt-6 max-w-lg mx-auto space-y-5 px-container-padding">

                    {/* Page Header */}
                    <div className="flex justify-between items-center animate-zoom-in-fade">
                        <div className="flex flex-col">
                            <h2 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">Add Petrol</h2>
                            <p className="text-[11px] text-on-surface-variant font-medium mt-0.5">Fuel &amp; Ride Tracker</p>
                        </div>
                        <div className="relative w-12 h-12 glass-card rounded-full flex items-center justify-center overflow-hidden">
                            <span className="material-symbols-outlined text-primary z-10" style={{ fontVariationSettings: "'FILL' 1" }}>local_gas_station</span>
                            <div 
                                className="absolute bottom-0 left-0 w-full bg-primary/40 transition-all duration-500 rounded-b-full"
                                style={{ height: `${Math.min(100, (parseFloat(litres)||0)/60*100 * 0.4 + (parseFloat(pricePerLitre)||0)/300*100 * 0.4)}%` }}
                            ></div>
                        </div>
                    </div>

                    {/* Odometer Hero Card */}
                    <div className="glass-card rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden animate-zoom-in-fade" style={{ border: '1px solid rgba(45,232,168,0.2)', boxShadow: '0 0 20px rgba(45,232,168,0.08)' }}>
                        {/* Scanlines overlay */}
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(18,16,16,0) 50%,rgba(0,0,0,0.25) 50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))', backgroundSize: '100% 4px,3px 100%' }}></div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Estimated Total</span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl text-on-surface font-bold opacity-50 font-mono">PKR</span>
                            <span className="font-mono text-5xl font-extrabold text-on-surface tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {estTotal.toFixed(2).padStart(6, '0')}
                            </span>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <span className="px-2 py-1 rounded text-[10px] font-bold tracking-tight border" style={{ background: 'rgba(45,232,168,0.1)', color: '#56f1c2', borderColor: 'rgba(45,232,168,0.2)' }}>PREMIUM 98</span>
                            <span className="px-2 py-1 rounded text-[10px] font-bold tracking-tight border border-outline/30 text-on-surface-variant bg-surface-container">ECONOMY MODE</span>
                        </div>
                    </div>



                    {/* Form Section */}
                    <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>

                        {/* Litres Input with Gauge */}
                        <div className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-300 hover:bg-white/5 input-glow">
                            <div className="flex flex-col flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Volume (Litres)</label>
                                <input
                                    className="bg-transparent border-none text-3xl font-mono font-bold text-on-surface focus:ring-0 focus:outline-none w-full placeholder:text-outline/40"
                                    placeholder="0.00"
                                    step="0.01"
                                    type="number"
                                    value={litres}
                                    onChange={(e) => setLitres(e.target.value)}
                                    style={{ WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                                />
                            </div>
                            {/* Circular SVG Gauge */}
                            <div className="relative w-14 h-14 ml-4 flex-shrink-0">
                                <svg className="w-full h-full" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                                    <circle fill="none" stroke="#2d3449" strokeWidth="4" cx="18" cy="18" r="15.915" />
                                    <circle
                                        fill="none"
                                        stroke="#56f1c2"
                                        strokeWidth="4"
                                        cx="18" cy="18" r="15.915"
                                        strokeDasharray="100"
                                        strokeDashoffset={litreGaugeDashoffset}
                                        strokeLinecap="round"
                                        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '18px' }}>water_drop</span>
                                </div>
                            </div>
                        </div>

                        {/* Price Per Litre Input */}
                        <div className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-300 hover:bg-white/5 input-glow">
                            <div className="flex flex-col flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Price per Litre (PKR)</label>
                                <input
                                    className="bg-transparent border-none text-3xl font-mono font-bold text-on-surface focus:ring-0 focus:outline-none w-full placeholder:text-outline/40"
                                    placeholder="0.00"
                                    step="0.01"
                                    type="number"
                                    value={pricePerLitre}
                                    onChange={(e) => setPricePerLitre(e.target.value)}
                                    style={{ WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                                />
                            </div>
                            <span className="ml-4 font-mono text-sm font-bold tracking-widest text-primary">PKR</span>
                        </div>

                        {/* Date Input */}
                        <div className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-300 hover:bg-white/5 input-glow">
                            <div className="flex flex-col flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Date</label>
                                <input
                                    className="bg-transparent border-none text-xl font-semibold text-on-surface focus:ring-0 focus:outline-none w-full appearance-none"
                                    type="date"
                                    value={fillDate}
                                    onChange={(e) => setFillDate(e.target.value)}
                                />
                            </div>
                            <span className="material-symbols-outlined text-on-surface-variant ml-4">calendar_today</span>
                        </div>

                        {/* Fallback Reserve Input */}
                        <div className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-300 hover:bg-white/5 input-glow border-l-4 border-error">
                            <div className="flex flex-col flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Rode on reserve before this fill? (optional)</label>
                                <input
                                    className="bg-transparent border-none text-xl font-semibold text-on-surface focus:ring-0 focus:outline-none w-full placeholder:text-outline/40"
                                    placeholder="Enter km"
                                    type="number"
                                    value={fallbackReserveDistance}
                                    onChange={(e) => setFallbackReserveDistance(e.target.value)}
                                    style={{ WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                                />
                            </div>
                            <span className="material-symbols-outlined text-error ml-4">warning</span>
                        </div>

                        {/* Save Button with confetti */}
                        <div className="pt-4 pb-6">
                            <button
                                id="petrol-save-btn"
                                className="w-full py-5 rounded-full flex items-center justify-center gap-3 font-bold text-lg active:scale-95 transition-all duration-200 overflow-hidden relative group cursor-pointer"
                                style={{
                                    backgroundImage: 'linear-gradient(90deg, #2DE8A8, #1FB382, #2DE8A8)',
                                    color: '#003829',
                                    boxShadow: '0 0 25px rgba(45,212,167,0.35)',
                                }}
                                onClick={() => {
                                    savePetrolEntry();
                                    const btn = document.getElementById('petrol-save-btn');
                                    if (!btn) return;
                                    const rect = btn.getBoundingClientRect();
                                    const container = document.getElementById('petrol-confetti');
                                    if (!container) return;
                                    for (let i = 0; i < 40; i++) {
                                        const piece = document.createElement('div');
                                        piece.style.cssText = `position:fixed;width:8px;height:8px;border-radius:2px;background:${i%2===0?'#56f1c2':'#ffc640'};left:${rect.left+rect.width/2}px;top:${rect.top+rect.height/2}px;pointer-events:none;z-index:9999;`;
                                        container.appendChild(piece);
                                        const angle = Math.random()*Math.PI*2;
                                        const dist = 80+Math.random()*160;
                                        piece.animate([
                                            { transform:'translate(0,0) scale(1)', opacity:1 },
                                            { transform:`translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px) scale(0)`, opacity:0 }
                                        ],{ duration:900+Math.random()*600, easing:'cubic-bezier(0.25,0.46,0.45,0.94)' }).onfinish = () => piece.remove();
                                    }
                                }}
                            >
                                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-500 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none"></div>
                                <span className="material-symbols-outlined relative z-10">save</span>
                                <span className="relative z-10 font-bold uppercase tracking-widest">Save Entry</span>
                            </button>
                            <div id="petrol-confetti" className="fixed inset-0 pointer-events-none z-[999]"></div>
                        </div>
                    </form>
                </main>
            </div>
        );
    };

    const renderPersonalTrip = () => {
        const tripTimeText = currentTrip && currentTrip.startTime
            ? Math.floor((Date.now() - new Date(currentTrip.startTime).getTime()) / 60000) + ' min'
            : '0 min';

        const distanceVal = currentTrip ? currentTrip.distance : 0;

        // Dynamic metrics logic for Bento Grid & Stats
        const effectiveMileageData = getEffectiveMileage(petrolEntries);
        const lastFuelCost = petrolEntries.length > 0
            ? (petrolEntries[0].litres * petrolEntries[0].pricePerLitre)
            : 0;


        const latestPrice = petrolEntries.length > 0 ? petrolEntries[0].pricePerLitre : 272; 
        const activeMileage = effectiveMileageData.mileage > 0 ? effectiveMileageData.mileage : 45; 
        const costPerKm = latestPrice / activeMileage;
        const tripCost = distanceVal * costPerKm;
        const lastLitres = petrolEntries.length > 0 ? petrolEntries[0].litres : 10;
        const range = lastLitres * activeMileage;
        const fuelLeftPct = range > 0 
            ? Math.max(0, Math.min(100, 100 - (totalKmSinceLastFill / range) * 100)) 
            : 70;

        // Speedometer parameters mapping
        const roundedSpeed = Math.round(smoothSpeed);

        // Check if personal trip tracking is active
        const isPersonalActive = isTracking && currentTrip && !currentTrip.isRide;
        const isRideActiveInTracking = isTracking && currentTrip && currentTrip.isRide;

        return (
            <div className="w-full">
                {/* Atmospheric Background Decor */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
                    <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]"></div>
                    <div className="absolute top-[40%] -right-[10%] w-[30%] h-[30%] bg-secondary/5 rounded-full blur-[100px]"></div>
                </div>

                {isPersonalActive ? (
                    /* layout when personal trip is active (TRIP IN PROGRESS) */
                    <div className="w-full animate-zoom-in-fade">


                        <main className="px-container-padding space-y-element-gap mt-4 max-w-md mx-auto">
                            {/* Trip Type Badge */}
                            <div className="w-full py-3 bg-gradient-to-r from-primary-container to-primary rounded-full flex items-center justify-center animate-pulse-record shadow-[0_0_20px_rgba(78,204,163,0.3)]">
                                <span className="font-label-caps text-label-caps text-on-primary-container uppercase font-bold">🏍️ PERSONAL TRIP IN PROGRESS ({tripTimeText})</span>
                            </div>

                            {/* GPS Signal Loss Banner */}
                            {gpsSignalLost && (
                                <div className="glass-card rounded-xl overflow-hidden flex items-center border-l-4 border-l-tertiary bg-tertiary/10 p-3 animate-pulse">
                                    <span className="material-symbols-outlined text-tertiary mr-2">satellite_alt</span>
                                    <span className="font-body-md text-tertiary font-bold text-xs">{gpsSignalLossBannerMessage}</span>
                                </div>
                            )}

                            <section className="flex flex-col items-center justify-center py-6 w-full">
                                <div className="relative w-full max-w-xs h-40 glass-card rounded-3xl flex items-center justify-center">
                                    {/* Digital Readout */}
                                    <div className="flex flex-col items-center z-10">
                                        <span className="font-display-hero text-6xl text-on-background font-extrabold">{roundedSpeed}</span>
                                        <span className="font-label-caps text-label-caps text-primary opacity-80 uppercase font-bold">km/h</span>
                                    </div>
                                </div>
                            </section>

                            {/* GPS Status Strip */}
                            <div className="glass-card rounded-xl overflow-hidden flex items-center border-l-4 border-l-primary">
                                <div className="p-3 w-full">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-label-caps text-[10px] text-primary uppercase font-bold">GPS STATUS</span>
                                        <div className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                            <span className="font-label-caps text-[10px] text-on-surface font-bold">
                                                {gpsSignalLost ? 'Signal Lost' : 'Tracking Personal (High Accuracy)'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="font-mono text-[11px] text-on-surface-variant flex gap-4">
                                        <span>Updates: {gpsDebug.updates}</span>
                                        <span>Accuracy: {gpsDebug.accuracy ? gpsDebug.accuracy.toFixed(0) : '8'}m</span>
                                        <span className="ml-auto">LAT: {gpsDebug.lastLat ? gpsDebug.lastLat.toFixed(4) : '0.0000'}° N</span>
                                    </div>
                                </div>
                            </div>

                            {/* Trip Status Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="glass-card p-4 rounded-2xl active-glow">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">CURRENT TRIP</span>
                                        {gpsSignalLost ? (
                                            <div className="space-y-1">
                                                <div className="text-[11px] text-on-surface-variant font-medium">GPS: {distanceVal.toFixed(2)} km</div>
                                                <div className="text-[11px] text-tertiary font-medium">+ Est: {estimatedDistance.toFixed(2)} km</div>
                                                <div className="flex items-baseline gap-1 border-t border-white/10 pt-1">
                                                    <span className="font-stats-numeral text-body-lg text-primary font-bold">{(distanceVal + estimatedDistance).toFixed(2)}</span>
                                                    <span className="font-label-caps text-[8px] text-primary font-bold">KM</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-baseline gap-1">
                                                <span className="font-stats-numeral text-headline-md text-primary font-bold">{distanceVal.toFixed(2)}</span>
                                                <span className="font-label-caps text-[10px] text-primary font-bold">KM</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="glass-card p-4 rounded-2xl">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">TOTAL</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className="font-stats-numeral text-headline-md text-on-background font-bold">{totalKmSinceLastFill.toFixed(2)}</span>
                                            <span className="font-label-caps text-[10px] text-on-surface-variant font-bold">KM</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Fuel Expense Card (Bento Grid) */}
                            <div className="glass-card p-4 rounded-3xl space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">FUEL EXPENSES</h3>
                                    <span className="material-symbols-outlined text-primary-container text-sm">payments</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-surface-container-low rounded-xl p-3">
                                        <span className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase font-bold">TANK SPENT</span>
                                        <span className="font-stats-numeral text-body-lg text-on-surface font-semibold">PKR {lastFuelCost > 0 ? lastFuelCost.toFixed(0) : '0'}</span>
                                    </div>
                                    <div className="bg-surface-container-low rounded-xl p-3 active-glow">
                                        <span className="block font-label-caps text-[10px] text-primary mb-1 uppercase font-bold">TRIP COST</span>
                                        <span className="font-stats-numeral text-body-lg text-primary font-semibold">PKR {tripCost.toFixed(2)}</span>
                                    </div>
                                    <div className="bg-surface-container-low rounded-xl p-3">
                                        <span className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase font-bold">COST/KM</span>
                                        <span className="font-stats-numeral text-body-lg text-on-surface font-semibold">PKR {costPerKm.toFixed(2)}</span>
                                    </div>
                                    <div className="bg-surface-container-low rounded-xl p-3 flex flex-col justify-center">
                                        <span className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase font-bold">FUEL LEFT</span>
                                        <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-primary h-full shadow-[0_0_8px_#4ECCA3]" style={{ width: `${fuelLeftPct}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Reserve Controls */}
                            <div className="flex flex-col gap-2 pt-2">
                                <button
                                    className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all cursor-pointer border ${reserveActive ? 'bg-error-container text-on-error-container border-error' : 'glass-card text-on-surface-variant hover:bg-white/5 border-white/10'}`}
                                    onClick={() => {
                                        if (!reserveActive) {
                                            setReserveActive(true);
                                            setReserveStartDistance(totalKmSinceLastFill);
                                        } else {
                                            setReserveActive(false);
                                            setReserveStartDistance(0);
                                        }
                                    }}
                                >
                                    <span className="material-symbols-outlined">{reserveActive ? 'warning' : 'local_gas_station'}</span>
                                    <span className="font-headline-md font-bold uppercase">{reserveActive ? 'Reserve Active' : 'Switch to Reserve'}</span>
                                </button>
                                <button 
                                    className="w-full py-4 rounded-2xl border border-white/10 glass-card flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-95 cursor-pointer"
                                    onClick={() => setShowAddReserveModal(true)}
                                >
                                    <span className="material-symbols-outlined text-on-surface-variant">add_circle</span>
                                    <span className="font-body-lg text-on-surface font-semibold">Add Reserve Manually</span>
                                </button>
                            </div>

                            {/* Primary Control */}
                            <button 
                                className="w-full py-5 rounded-2xl bg-gradient-to-br from-error-container to-[#ff5252] shadow-2xl shadow-error/30 flex items-center justify-center gap-3 active:scale-[0.98] transition-all animate-pulse-record cursor-pointer"
                                onClick={stopTrip}
                            >
                                <span className="material-symbols-outlined text-on-error-container fill-current font-bold">stop_circle</span>
                                <span className="font-headline-md text-on-error-container uppercase tracking-widest font-bold">STOP TRIP</span>
                            </button>
                        </main>
                    </div>
                ) : isRideActiveInTracking ? (
                    /* layout when ride trip is active (RIDE TRIP IN PROGRESS) */
                    <div className="w-full animate-zoom-in-fade">
                        <main className="px-container-padding space-y-element-gap max-w-md mx-auto mt-4">
                            {/* Speedometer Section */}
                            <section className="flex flex-col items-center py-6 relative w-full">
                                <div className="relative w-full max-w-xs h-40 glass-card rounded-3xl flex items-center justify-center">
                                    <div className="flex flex-col items-center z-10">
                                        <span className="font-display-hero text-[64px] text-white tracking-tighter leading-none font-extrabold">{roundedSpeed}</span>
                                        <span className="font-label-caps text-on-surface-variant uppercase font-bold">km/h</span>
                                    </div>
                                </div>
                                {/* Active Trip Badge */}
                                <div className="w-full ride-gradient rounded-full py-3 px-6 mt-6 flex items-center justify-center gap-3 animate-pulse shadow-[0_0_20px_rgba(118,75,162,0.4)]">
                                    <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>local_taxi</span>
                                    <span className="font-label-caps text-white tracking-widest font-bold">🚖 RIDE TRIP IN PROGRESS</span>
                                </div>
                            </section>

                            {/* GPS Signal Loss Banner */}
                            {gpsSignalLost && (
                                <div className="glass-card rounded-xl overflow-hidden flex items-center border-l-4 border-l-tertiary bg-tertiary/10 p-3 animate-pulse">
                                    <span className="material-symbols-outlined text-tertiary mr-2">satellite_alt</span>
                                    <span className="font-body-md text-tertiary font-bold text-xs">{gpsSignalLossBannerMessage}</span>
                                </div>
                            )}

                            {/* GPS Status Card */}
                            <div className="glass-card rounded-xl overflow-hidden flex items-center border-l-4 border-l-secondary">
                                <div className="p-3 w-full">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-label-caps text-[10px] text-secondary uppercase font-bold">GPS STATUS</span>
                                        <div className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                                            <span className="font-label-caps text-[10px] text-on-surface font-bold">
                                                {gpsSignalLost ? 'Signal Lost' : 'Tracking Ride (High Accuracy)'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="font-mono text-[11px] text-on-surface-variant flex gap-4">
                                        <span>Updates: {gpsDebug.updates}</span>
                                        <span>Accuracy: {gpsDebug.accuracy ? gpsDebug.accuracy.toFixed(0) : '8'}m</span>
                                        <span className="ml-auto">LAT: {gpsDebug.lastLat ? gpsDebug.lastLat.toFixed(4) : '0.0000'}° N</span>
                                    </div>
                                </div>
                            </div>

                            {/* GPS & Trip Stats Grid */}
                            <section className="grid grid-cols-2 gap-element-gap">

                                <div className="glass-card rounded-xl p-4 border border-secondary/20 ride-glow">
                                    <p className="font-label-caps text-on-surface-variant text-[11px] uppercase mb-1 font-bold">Current Ride</p>
                                    {gpsSignalLost ? (
                                        <div className="space-y-1">
                                            <div className="text-[11px] text-on-surface-variant font-medium">GPS: {distanceVal.toFixed(2)} km</div>
                                            <div className="text-[11px] text-tertiary font-medium">+ Est: {estimatedDistance.toFixed(2)} km</div>
                                            <div className="flex items-baseline gap-1 border-t border-white/10 pt-1">
                                                <span className="font-stats-numeral text-white text-[18px] font-bold">{(distanceVal + estimatedDistance).toFixed(2)}</span>
                                                <span className="text-on-surface-variant text-[10px] font-bold">km</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-baseline gap-1">
                                            <span className="font-stats-numeral text-white text-[24px] font-bold">{distanceVal.toFixed(2)}</span>
                                            <span className="text-on-surface-variant text-[12px] font-bold">km</span>
                                        </div>
                                    )}
                                </div>
                                <div className="glass-card rounded-xl p-4 border border-secondary/20">
                                    <p className="font-label-caps text-on-surface-variant text-[11px] uppercase mb-1 font-bold">Total Trip</p>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-stats-numeral text-white text-[24px] font-bold">{totalKmSinceLastFill.toFixed(1)}</span>
                                        <span className="text-on-surface-variant text-[12px] font-bold">km</span>
                                    </div>
                                </div>
                            </section>

                            {/* Reserve Controls */}
                            <section className="pt-2 flex flex-col gap-2">
                                <button
                                    className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all cursor-pointer border ${reserveActive ? 'bg-error-container text-on-error-container border-error' : 'glass-card text-on-surface-variant hover:bg-white/5 border-white/10'}`}
                                    onClick={() => {
                                        if (!reserveActive) {
                                            setReserveActive(true);
                                            setReserveStartDistance(totalKmSinceLastFill);
                                        } else {
                                            setReserveActive(false);
                                            setReserveStartDistance(0);
                                        }
                                    }}
                                >
                                    <span className="material-symbols-outlined">{reserveActive ? 'warning' : 'local_gas_station'}</span>
                                    <span className="font-headline-md font-bold uppercase">{reserveActive ? 'Reserve Active' : 'Switch to Reserve'}</span>
                                </button>

                            </section>

                            {/* Primary Controls */}
                            <section className="pt-4">
                                <button className="w-full bg-gradient-to-r from-red-500 to-rose-700 rounded-2xl py-5 flex items-center justify-center gap-3 text-white font-headline-md pulse-recording transition-transform active:scale-95 font-bold cursor-pointer" onClick={stopTrip}>
                                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>stop_circle</span>
                                    COMPLETE RIDE
                                </button>
                            </section>
                        </main>
                    </div>
                ) : (
                    /* layout before any trip starts (IDLE STATE) */
                    <div className="w-full">


                        {/* Main Content Canvas */}
                        <main className="w-full max-w-md px-container-padding mt-6 flex flex-col gap-element-gap mx-auto">
                            {/* Header Section */}
                            <section className="flex flex-col gap-1">
                                <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold">Tracking</h1>
                                <p className="font-body-md text-on-surface-variant">Track your personal and business trips.</p>
                            </section>

                            {/* Dynamic Map Background for Context */}
                            <div className="relative w-full h-48 rounded-xl overflow-hidden glass-card">
                                <div className="absolute inset-0 bg-cover bg-center opacity-40 grayscale contrast-125" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDZp2tQnZltNyEVEUJIItVGgk2pWiRDQwDRHIbmmuDMkNm4Pv63tzwBu_ig6X-c2mTR4l79re2KxaVF0HmJD1K7AvKSASYCCuN7R0O9DGRBMq7BpA51OccYZe8PHUpILskiUC3H4g7jKcnJ1DpsCmZ6hkC2byCfzICjYC7HP2YeGAjY5bCVVvWE78o_LxVyunj7fBZ-FrbtkkKDAgP9IZexQ5yLGMqRNf4H5SH39EUSftuZHs6ign44Ww')" }}></div>
                                <div className="absolute inset-0 bg-gradient-to-t from-surface-dim to-transparent"></div>
                                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(109,233,190,1)]"></div>
                                    <span className="font-label-caps text-label-caps text-primary uppercase font-bold">GPS Ready</span>
                                </div>
                            </div>

                            {/* Call to Action Section */}
                            <section className="mt-6 flex flex-col gap-4">
                                <button 
                                    className={`primary-gradient w-full py-5 rounded-2xl flex items-center justify-center shadow-[0_8px_32px_rgba(0,108,81,0.3)] hover:shadow-[0_12px_48px_rgba(109,233,190,0.4)] transition-all duration-300 active:scale-95 group cursor-pointer ${isTracking ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    onClick={() => {
                                        if (isTracking) {
                                            alert("A business ride trip is already in progress. Stop that trip before starting a personal trip.");
                                        } else {
                                            startGPSTracking(false);
                                        }
                                    }}
                                >
                                    <span className="font-headline-md text-headline-md text-on-primary font-bold">Start Trip</span>
                                </button>
                                <button 
                                    className="w-full py-4 rounded-2xl border border-white/10 glass-card flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-95 cursor-pointer"
                                    onClick={() => setShowManualEntry(true)}
                                >
                                    <span className="material-symbols-outlined text-on-surface-variant">add_circle</span>
                                    <span className="font-body-lg text-body-lg text-on-surface font-semibold">Add Manual KM</span>
                                </button>
                                <button 
                                    className="w-full py-4 rounded-2xl ride-gradient flex items-center justify-center gap-2 shadow-[0_8px_32px_rgba(31,59,166,0.3)] hover:shadow-[0_12px_48px_rgba(185,195,255,0.3)] transition-all duration-300 active:scale-95 cursor-pointer"
                                    onClick={() => startGPSTracking(true)}
                                >
                                    <span className="material-symbols-outlined text-on-primary text-xl">play_circle</span>
                                    <span className="font-headline-md text-headline-md text-on-primary font-bold">Start Ride</span>
                                </button>
                                <button 
                                    className="w-full py-4 rounded-2xl border border-white/10 glass-card flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-95 cursor-pointer"
                                    onClick={() => setShowRideEntry(true)}
                                >
                                    <span className="material-symbols-outlined text-on-surface-variant">add_circle</span>
                                    <span className="font-body-lg text-body-lg text-on-surface font-semibold">Manual Ride</span>
                                </button>
                                <button 
                                    className="w-full py-4 rounded-2xl border border-white/10 glass-card flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-95 cursor-pointer mt-2"
                                    onClick={() => setShowAddReserveModal(true)}
                                >
                                    <span className="material-symbols-outlined text-on-surface-variant">add_circle</span>
                                    <span className="font-body-lg text-body-lg text-on-surface font-semibold">Add Reserve Manually</span>
                                </button>
                            </section>

                            {/* Info Tip */}
                            <div className="flex items-start gap-3 p-4 bg-surface-container-low/50 rounded-xl border border-white/5 mt-4">
                                <span className="material-symbols-outlined text-primary/60 text-sm">info</span>
                                <p className="font-body-md text-body-md text-on-surface-variant/80 italic text-sm">
                                    In private mode, trip details are not synced to your business dashboard. Use Start Ride and Manual Ride for business tracking.
                                </p>
                            </div>
                        </main>
                    </div>
                )}
            </div>
        );
    };

    const renderRideTrip = () => {
        const rideSummary = getRideSummary;
        const distanceVal = currentTrip ? currentTrip.distance : 0;





        // Speedometer parameters mapping
        const roundedSpeed = Math.round(smoothSpeed);


        const isRideActive = isTracking && currentTrip && currentTrip.isRide;

        return (
            <div className="w-full">
                {/* Background Layer */}
                <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                    <div className="absolute inset-0 map-mesh opacity-10"></div>
                    <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-secondary-container/20 blur-[120px] rounded-full animate-pulse-slow"></div>
                </div>

                {isRideActive ? (
                    /* RIDE ACTIVE TRACKING STATE */
                    <div className="w-full relative z-10 animate-zoom-in-fade">


                        <main className="px-container-padding space-y-element-gap max-w-md mx-auto mt-4">
                            {/* Speedometer Section */}
                            <section className="flex flex-col items-center py-6 relative w-full">
                                <div className="relative w-full max-w-xs h-40 glass-card rounded-3xl flex items-center justify-center">
                                    {/* Digital Readout */}
                                    <div className="flex flex-col items-center z-10">
                                        <span className="font-display-hero text-[64px] text-white tracking-tighter leading-none font-extrabold">{roundedSpeed}</span>
                                        <span className="font-label-caps text-on-surface-variant uppercase font-bold">km/h</span>
                                    </div>
                                </div>
                                {/* Active Trip Badge */}
                                <div className="w-full ride-gradient rounded-full py-3 px-6 mt-6 flex items-center justify-center gap-3 animate-pulse shadow-[0_0_20px_rgba(118,75,162,0.4)]">
                                    <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>local_taxi</span>
                                    <span className="font-label-caps text-white tracking-widest font-bold">🚖 RIDE TRIP IN PROGRESS</span>
                                </div>
                            </section>

                            {/* GPS Status Card */}
                            <div className="glass-card rounded-xl overflow-hidden flex items-center border-l-4 border-l-secondary">
                                <div className="p-3 w-full">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-label-caps text-[10px] text-secondary uppercase font-bold">GPS STATUS</span>
                                        <div className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                                            <span className="font-label-caps text-[10px] text-on-surface font-bold">
                                                {gpsSignalLost ? 'Signal Lost' : 'Tracking Ride (High Accuracy)'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="font-mono text-[11px] text-on-surface-variant flex gap-4">
                                        <span>Updates: {gpsDebug.updates}</span>
                                        <span>Accuracy: {gpsDebug.accuracy ? gpsDebug.accuracy.toFixed(0) : '8'}m</span>
                                        <span className="ml-auto">LAT: {gpsDebug.lastLat ? gpsDebug.lastLat.toFixed(4) : '0.0000'}° N</span>
                                    </div>
                                </div>
                            </div>

                            {/* GPS & Trip Stats Grid */}
                            <section className="grid grid-cols-2 gap-element-gap">

                                <div className="glass-card rounded-xl p-4 border border-secondary/20 ride-glow">
                                    <p className="font-label-caps text-on-surface-variant text-[11px] uppercase mb-1 font-bold">Current Ride</p>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-stats-numeral text-white text-[24px] font-bold">{distanceVal.toFixed(2)}</span>
                                        <span className="text-on-surface-variant text-[12px] font-bold">km</span>
                                    </div>
                                </div>
                                <div className="glass-card rounded-xl p-4 border border-secondary/20">
                                    <p className="font-label-caps text-on-surface-variant text-[11px] uppercase mb-1 font-bold">Total Trip</p>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-stats-numeral text-white text-[24px] font-bold">{totalKmSinceLastFill.toFixed(1)}</span>
                                        <span className="text-on-surface-variant text-[12px] font-bold">km</span>
                                    </div>
                                </div>
                            </section>

                            {/* Primary Controls */}
                            <section className="pt-4">
                                <button className="w-full bg-gradient-to-r from-red-500 to-rose-700 rounded-2xl py-5 flex items-center justify-center gap-3 text-white font-headline-md pulse-recording transition-transform active:scale-95 font-bold cursor-pointer" onClick={stopTrip}>
                                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>stop_circle</span>
                                    COMPLETE RIDE
                                </button>
                            </section>
                        </main>
                    </div>
                ) : (
                    /* RIDE IDLE STATE */
                    <div className="w-full relative z-10 animate-zoom-in-fade">


                        <main className="px-container-padding flex flex-col max-w-md mx-auto mt-6">
                            {/* Header */}
                            <div className="mb-6">
                                <h1 className="font-display-hero text-headline-lg text-on-surface leading-tight font-extrabold">Earning Details</h1>
                                <p className="font-body-lg text-body-md text-on-surface-variant mt-2">Track your daily and monthly ride earnings.</p>
                            </div>

                            {/* Daily / Monthly Earnings Toggle */}
                            <div className="flex gap-3 mb-6">
                                <button
                                    className={`flex-1 py-3 rounded-xl font-headline-md text-[14px] font-bold transition-all duration-300 active:scale-95 cursor-pointer ${
                                        earningsView === 'daily'
                                            ? 'primary-gradient text-on-primary shadow-[0_4px_16px_rgba(0,108,81,0.4)]'
                                            : 'glass-card border border-white/10 text-on-surface-variant hover:bg-white/5'
                                    }`}
                                    onClick={() => setEarningsView('daily')}
                                >
                                    Daily Earnings
                                </button>
                                <button
                                    className={`flex-1 py-3 rounded-xl font-headline-md text-[14px] font-bold transition-all duration-300 active:scale-95 cursor-pointer ${
                                        earningsView === 'monthly'
                                            ? 'primary-gradient text-on-primary shadow-[0_4px_16px_rgba(0,108,81,0.4)]'
                                            : 'glass-card border border-white/10 text-on-surface-variant hover:bg-white/5'
                                    }`}
                                    onClick={() => setEarningsView('monthly')}
                                >
                                    Monthly Earnings
                                </button>
                            </div>





                        </main>
                    </div>
                )}

                {/* Earnings Cards */}
                {!isRideActive && (
                    <main className="px-container-padding max-w-md mx-auto mt-6">

                        {/* Daily Earnings Card */}
                        {earningsView === 'daily' && (() => {
                            const todayStr = new Date().toDateString();
                            const todayRides = rideEntries.filter(r => new Date(r.date).toDateString() === todayStr);
                            const dailyTotalRides = todayRides.length;
                            const dailyTotalKm = todayRides.reduce((s, r) => s + (r.km || 0), 0);
                            const dailyGrossEarnings = todayRides.reduce((s, r) => s + (r.totalEarnings || 0), 0);
                            const dailyTotalTips = todayRides.reduce((s, r) => s + (r.tip || 0), 0);
                            const dailyFuelCost = todayRides.reduce((s, r) => s + (r.fuelCost || 0), 0);
                            const dailyProfit = dailyGrossEarnings - dailyFuelCost;
                            const dailyAvgProfitPerKm = dailyTotalKm > 0 ? dailyProfit / dailyTotalKm : 0;
                            return (
                                <section className="glass-card rounded-2xl p-6 border-t border-white/10">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="font-headline-md text-white font-bold">Today's Earnings</h3>
                                        <span className="text-secondary font-label-caps font-bold">Today</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                                        <div>
                                            <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Total Rides</p>
                                            <p className="font-stats-numeral text-white text-[28px] font-bold">{dailyTotalRides}</p>
                                        </div>
                                        <div>
                                            <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Distance</p>
                                            <p className="font-stats-numeral text-white text-[28px] font-bold">{dailyTotalKm.toFixed(0)}<span className="text-[14px] ml-1">km</span></p>
                                        </div>
                                        <div>
                                            <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Gross Earnings</p>
                                            <p className="font-stats-numeral text-primary text-[28px] font-bold">PKR {dailyGrossEarnings.toLocaleString('en-IN')}</p>
                                        </div>
                                        <div>
                                            <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Tips 🎁</p>
                                            <p className="font-stats-numeral text-tertiary-container text-[28px] font-bold">PKR {dailyTotalTips.toLocaleString('en-IN')}</p>
                                        </div>
                                        <div className="col-span-2 pt-2 border-t border-white/5">
                                            <p className="font-label-caps text-on-surface-variant text-[10px] uppercase mb-2 font-bold">Fuel Cost Offset</p>
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-error" 
                                                        style={{ width: `${dailyGrossEarnings > 0 ? Math.min(100, (dailyFuelCost / dailyGrossEarnings) * 100) : 0}%` }}
                                                    ></div>
                                                </div>
                                                <span className="font-stats-numeral text-error text-[16px] font-bold">PKR {dailyFuelCost.toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Daily Net Profit Tile */}
                                    <div className="mt-8 p-5 bg-primary/10 border border-primary/20 rounded-2xl flex flex-col items-center justify-center text-center shadow-[inset_0_0_20px_rgba(109,233,190,0.1)]">
                                        <p className="font-label-caps text-primary text-[12px] uppercase tracking-widest mb-1 font-bold">Net Daily Profit</p>
                                        <p className="font-display-hero text-primary text-[38px] leading-tight font-extrabold">PKR {dailyProfit.toLocaleString('en-IN')}</p>
                                        <p className="font-body-md text-on-surface-variant opacity-70 mt-1 font-semibold">PKR {dailyAvgProfitPerKm.toFixed(2)}/km efficiency</p>
                                    </div>
                                    {/* Today's Individual Rides */}
                                    <section className="mt-6 space-y-3">
                                        <h4 className="font-headline-md text-white font-bold text-[14px]">Today's Rides</h4>
                                        {todayRides.length === 0 ? (
                                            <div className="glass-card p-4 text-center text-on-surface-variant rounded-xl">
                                                No rides logged today yet.
                                            </div>
                                        ) : (
                                            todayRides.map(ride => (
                                                <div key={ride.id} className="glass-card rounded-xl overflow-hidden border-l-4 border-secondary flex flex-col hover:bg-surface-container-high transition-colors">
                                                    <div className="p-4 flex justify-between items-start">
                                                        <div>
                                                            <p className="font-label-caps text-on-surface-variant text-[11px] font-bold">
                                                                {new Date(ride.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                            </p>
                                                            <p className="font-body-lg text-white font-semibold">Ride Entry</p>
                                                        </div>
                                                        <div className="bg-primary/20 text-primary px-3 py-1 rounded-full font-label-caps text-[11px] font-bold">
                                                            + PKR {ride.profit.toFixed(0)} PROFIT
                                                        </div>
                                                    </div>
                                                    <div className="px-4 py-3 grid grid-cols-3 gap-2 bg-white/5">
                                                        <div>
                                                            <p className="text-[9px] text-on-surface-variant uppercase font-bold">Dist</p>
                                                            <div className="flex flex-col">
                                                                <span className="text-[13px] font-semibold text-white">{ride.km.toFixed(1)}km</span>
                                                                {ride.hasEstimatedSegment && (
                                                                    <span className="text-[9px] text-tertiary font-bold leading-none mt-0.5">
                                                                        ~{ride.estimatedKm.toFixed(1)}km EST
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[9px] text-on-surface-variant uppercase font-bold">Fare</p>
                                                            <p className="text-[13px] font-semibold text-white">PKR {(ride.earnings + ride.tip).toFixed(0)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[9px] text-on-surface-variant uppercase font-bold">Fuel</p>
                                                            <p className="text-[13px] font-semibold text-error">PKR {ride.fuelCost.toFixed(0)}</p>
                                                        </div>
                                                    </div>
                                                    <div className="px-4 py-2 border-t border-white/5 flex justify-between items-center text-[11px]">
                                                        <span className="text-on-surface-variant font-medium">Profit: <span className="text-primary">PKR {ride.profitPerKm.toFixed(1)}/km</span></span>
                                                        <span className="text-on-surface-variant font-medium">Cost: <span className="text-error">PKR {ride.costPerKm.toFixed(1)}/km</span></span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </section>
                                </section>
                            );
                        })()}

                        {/* Monthly Earnings Card */}
                        {earningsView === 'monthly' && (
                        <>
                        <section className="glass-card rounded-2xl p-6 border-t border-white/10">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-headline-md text-white font-bold">
                                    {new Date().toLocaleString('default', { month: 'long' })} Earnings
                                </h3>
                                <span className="text-secondary font-label-caps font-bold">This Month</span>
                            </div>
                            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                                <div>
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Total Rides</p>
                                    <p className="font-stats-numeral text-white text-[28px] font-bold">{rideSummary.totalRides}</p>
                                </div>
                                <div>
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Distance</p>
                                    <p className="font-stats-numeral text-white text-[28px] font-bold">{rideSummary.totalRideKm.toFixed(0)}<span className="text-[14px] ml-1">km</span></p>
                                </div>
                                <div>
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Gross Earnings</p>
                                    <p className="font-stats-numeral text-primary text-[28px] font-bold">PKR {rideSummary.totalEarnings.toLocaleString('en-IN')}</p>
                                </div>
                                <div>
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Tips 🎁</p>
                                    <p className="font-stats-numeral text-tertiary-container text-[28px] font-bold">PKR {rideSummary.totalTips.toLocaleString('en-IN')}</p>
                                </div>
                                <div className="col-span-2 pt-2 border-t border-white/5">
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase mb-2 font-bold">Fuel Cost Offset</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-error" 
                                                style={{ width: `${rideSummary.totalEarnings > 0 ? Math.min(100, (rideSummary.totalFuelCost / rideSummary.totalEarnings) * 100) : 0}%` }}
                                            ></div>
                                        </div>
                                        <span className="font-stats-numeral text-error text-[16px] font-bold">PKR {rideSummary.totalFuelCost.toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                            </div>
                            {/* Hero Net Profit Tile */}
                            <div className="mt-8 p-5 bg-primary/10 border border-primary/20 rounded-2xl flex flex-col items-center justify-center text-center shadow-[inset_0_0_20px_rgba(109,233,190,0.1)]">
                                <p className="font-label-caps text-primary text-[12px] uppercase tracking-widest mb-1 font-bold">Net Monthly Profit</p>
                                <p className="font-display-hero text-primary text-[38px] leading-tight font-extrabold">PKR {rideSummary.totalProfit.toLocaleString('en-IN')}</p>
                                <p className="font-body-md text-on-surface-variant opacity-70 mt-1 font-semibold">PKR {rideSummary.avgProfitPerKm.toFixed(2)}/km efficiency</p>
                            </div>
                        </section>

                        {/* Monthly Ride Summaries */}
                        <section className="space-y-4 pt-6 pb-20">
                            <h3 className="font-headline-md text-white px-2 font-bold">Monthly Summary</h3>
                            <div className="space-y-sm">
                                {(() => {
                                    // Group rides by date
                                    const dailyMap = {};
                                    rideEntries.forEach(ride => {
                                        const dayKey = new Date(ride.date).toDateString();
                                        if (!dailyMap[dayKey]) {
                                            dailyMap[dayKey] = { date: ride.date, rides: [] };
                                        }
                                        dailyMap[dayKey].rides.push(ride);
                                    });
                                    const dailySummaries = Object.values(dailyMap).sort((a, b) => new Date(b.date) - new Date(a.date));

                                    if (dailySummaries.length === 0) {
                                        return (
                                            <div className="glass-card p-lg text-center text-on-surface-variant rounded-xl">
                                                No rides logged this month yet.
                                            </div>
                                        );
                                    }

                                    return dailySummaries.map(day => {
                                        const totalRides = day.rides.length;
                                        const totalKm = day.rides.reduce((s, r) => s + (r.km || 0), 0);
                                        const totalEarnings = day.rides.reduce((s, r) => s + (r.earnings || 0) + (r.tip || 0), 0);
                                        const totalTips = day.rides.reduce((s, r) => s + (r.tip || 0), 0);
                                        const totalFuelCost = day.rides.reduce((s, r) => s + (r.fuelCost || 0), 0);
                                        const totalProfit = day.rides.reduce((s, r) => s + (r.profit || 0), 0);
                                        const dateObj = new Date(day.date);
                                        const dateLabel = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();

                                        return (
                                            <div 
                                                key={dateObj.toDateString()} 
                                                className="glass-card rounded-xl overflow-hidden border-l-4 border-secondary flex flex-col hover:bg-surface-container-high transition-colors cursor-pointer"
                                                onClick={() => setExpandedDay(expandedDay === dateObj.toDateString() ? null : dateObj.toDateString())}
                                            >
                                                <div className="p-4 flex justify-between items-start">
                                                    <div>
                                                        <p className="font-label-caps text-on-surface-variant text-[11px] font-bold">{dateLabel}</p>
                                                        <p className="font-body-lg text-white font-semibold">{totalRides} {totalRides === 1 ? 'Ride' : 'Rides'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="bg-primary/20 text-primary px-3 py-1 rounded-full font-label-caps text-[11px] font-bold">
                                                            + PKR {totalProfit.toFixed(0)} PROFIT
                                                        </div>
                                                        <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
                                                            {expandedDay === dateObj.toDateString() ? 'expand_less' : 'expand_more'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="px-4 py-3 grid grid-cols-4 gap-2 bg-white/5">
                                                    <div>
                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Dist</p>
                                                        <p className="text-[13px] font-semibold text-white">{totalKm.toFixed(1)}km</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Earnings</p>
                                                        <p className="text-[13px] font-semibold text-white">PKR {totalEarnings.toFixed(0)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Tips</p>
                                                        <p className="text-[13px] font-semibold text-tertiary-container">PKR {totalTips.toFixed(0)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Fuel</p>
                                                        <p className="text-[13px] font-semibold text-error">PKR {totalFuelCost.toFixed(0)}</p>
                                                    </div>
                                                </div>
                                                <div className="px-4 py-2 border-t border-white/5 flex justify-between items-center text-[11px]">
                                                    <span className="text-on-surface-variant font-medium">Profit/km: <span className="text-primary">PKR {totalKm > 0 ? (totalProfit / totalKm).toFixed(1) : '0.0'}/km</span></span>
                                                    <span className="text-on-surface-variant font-medium">Cost/km: <span className="text-error">PKR {totalKm > 0 ? (totalFuelCost / totalKm).toFixed(1) : '0.0'}/km</span></span>
                                                </div>
                                                
                                                {/* Expanded Rides List */}
                                                {expandedDay === dateObj.toDateString() && (
                                                    <div className="bg-surface-dim/30 border-t border-white/5 p-4 space-y-3">
                                                        {day.rides.map(ride => (
                                                            <div key={ride.id} className="glass-card rounded-xl overflow-hidden border-l-4 border-secondary flex flex-col hover:bg-surface-container-high transition-colors">
                                                                <div className="p-4 flex justify-between items-start">
                                                                    <div>
                                                                        <p className="font-label-caps text-on-surface-variant text-[11px] font-bold">
                                                                            {new Date(ride.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                                        </p>
                                                                        <p className="font-body-lg text-white font-semibold">Ride Entry</p>
                                                                    </div>
                                                                    <div className="bg-primary/20 text-primary px-3 py-1 rounded-full font-label-caps text-[11px] font-bold">
                                                                        + PKR {ride.profit.toFixed(0)} PROFIT
                                                                    </div>
                                                                </div>
                                                                <div className="px-4 py-3 grid grid-cols-3 gap-2 bg-white/5">
                                                                    <div>
                                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Dist</p>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-[13px] font-semibold text-white">{ride.km.toFixed(1)}km</span>
                                                                            {ride.hasEstimatedSegment && (
                                                                                <span className="text-[9px] text-tertiary font-bold leading-none mt-0.5">
                                                                                    ~{ride.estimatedKm.toFixed(1)}km EST
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Fare</p>
                                                                        <p className="text-[13px] font-semibold text-white">PKR {(ride.earnings + ride.tip).toFixed(0)}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[9px] text-on-surface-variant uppercase font-bold">Fuel</p>
                                                                        <p className="text-[13px] font-semibold text-error">PKR {ride.fuelCost.toFixed(0)}</p>
                                                                    </div>
                                                                </div>
                                                                <div className="px-4 py-2 border-t border-white/5 flex justify-between items-center text-[11px]">
                                                                    <span className="text-on-surface-variant font-medium">Profit: <span className="text-primary">PKR {ride.profitPerKm.toFixed(1)}/km</span></span>
                                                                    <span className="text-on-surface-variant font-medium">Cost: <span className="text-error">PKR {ride.costPerKm.toFixed(1)}/km</span></span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </section>
                        </>
                        )}
                    </main>
                )}
            </div>
        );
    };
    const renderCalculator = () => {
        const effectiveMileageData = getEffectiveMileage(petrolEntries);


        return (
            <div className="w-full animate-zoom-in-fade">

                <main className="px-container-padding space-y-6 max-w-md mx-auto pb-32">

                    {/* Warning Banner */}
                    {petrolEntries.length === 0 && (
                        <div className="calc-glass-panel calc-pulse-banner py-3 px-5 flex items-center gap-3" style={{ border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.08)' }}>
                            <span className="material-symbols-outlined text-yellow-400 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                            <p className="font-label-caps text-[11px] font-bold tracking-widest text-yellow-400">ADD FUEL DATA FIRST</p>
                        </div>
                    )}

                    {/* Inputs Card */}
                    <section className="calc-glass-panel p-6 space-y-7 calc-stagger-in" style={{ animationDelay: '100ms' }}>
                        <h2 className="font-headline-md text-on-surface flex items-center gap-2 font-bold text-lg">
                            <span className="material-symbols-outlined text-primary">calculate</span>
                            Fare Estimator
                        </h2>

                        <div className="space-y-5">

                            {/* Distance Input */}
                            <div className="space-y-2">
                                <label className="block font-label-caps text-[11px] text-on-surface-variant px-1 font-bold tracking-widest uppercase">Total Distance</label>
                                <div className="relative flex items-center calc-glass-panel p-1 calc-input-glow transition-all">
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcKm(v => String(Math.max(0, (parseFloat(v) || 0) - 1)))}
                                    >
                                        <span className="material-symbols-outlined">remove</span>
                                    </button>
                                    <input
                                        className="w-full bg-transparent border-none text-center font-bold text-2xl text-primary focus:ring-0 outline-none"
                                        placeholder="0.0"
                                        type="number"
                                        value={calcKm}
                                        onChange={(e) => setCalcKm(e.target.value)}
                                    />
                                    <span className="absolute right-12 text-xs font-bold text-on-surface-variant pointer-events-none">KM</span>
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcKm(v => String((parseFloat(v) || 0) + 1))}
                                    >
                                        <span className="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>

                            {/* Customer Offer */}
                            <div className="space-y-2">
                                <label className="block font-label-caps text-[11px] text-on-surface-variant px-1 font-bold tracking-widest uppercase">Customer Offer</label>
                                <div className="relative flex items-center calc-glass-panel p-1 calc-input-glow transition-all">
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcOffer(v => String(Math.max(0, (parseFloat(v) || 0) - 10)))}
                                    >
                                        <span className="material-symbols-outlined">remove</span>
                                    </button>
                                    <input
                                        className="w-full bg-transparent border-none text-center font-bold text-2xl focus:ring-0 outline-none"
                                        style={{ color: '#FF6B9D' }}
                                        placeholder="0"
                                        type="number"
                                        value={calcOffer}
                                        onChange={(e) => setCalcOffer(e.target.value)}
                                    />
                                    <span className="absolute right-12 text-xs font-bold text-on-surface-variant pointer-events-none">PKR</span>
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcOffer(v => String((parseFloat(v) || 0) + 10))}
                                    >
                                        <span className="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>

                            {/* Counter Offer */}
                            <div className="space-y-2">
                                <label className="block font-label-caps text-[11px] text-on-surface-variant px-1 font-bold tracking-widest uppercase flex justify-between">
                                    <span>Counter Offer</span>
                                    <span className="text-[10px] text-on-surface-variant/40 normal-case font-normal tracking-normal">Optional</span>
                                </label>
                                <div className="relative flex items-center calc-glass-panel p-1 calc-input-glow transition-all">
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcMyPrice(v => String(Math.max(0, (parseFloat(v) || 0) - 10)))}
                                    >
                                        <span className="material-symbols-outlined">remove</span>
                                    </button>
                                    <input
                                        className="w-full bg-transparent border-none text-center font-bold text-2xl text-yellow-400 focus:ring-0 outline-none"
                                        placeholder="0"
                                        type="number"
                                        value={calcMyPrice}
                                        onChange={(e) => setCalcMyPrice(e.target.value)}
                                    />
                                    <span className="absolute right-12 text-xs font-bold text-on-surface-variant pointer-events-none">PKR</span>
                                    <button
                                        className="p-2 hover:text-primary transition-colors text-on-surface-variant active:scale-95"
                                        onClick={() => setCalcMyPrice(v => String((parseFloat(v) || 0) + 10))}
                                    >
                                        <span className="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4 pt-2">
                            <button
                                className="flex-1 btn-coral-calc py-5 rounded-full font-bold text-white tracking-wide flex items-center justify-center gap-3 cursor-pointer"
                                onClick={calculateFare}
                            >
                                <span className="material-symbols-outlined">analytics</span>
                                CALCULATE FARE
                            </button>
                            <button
                                className="px-8 py-5 rounded-full border border-white/10 hover:bg-white/5 font-label-caps text-[11px] text-on-surface-variant transition-all tracking-widest cursor-pointer active:scale-95"
                                onClick={clearCalculator}
                            >
                                CLEAR ALL
                            </button>
                        </div>
                    </section>

                    {/* Results Panel */}
                    {calculationResult && (
                        <section className="glass-card border border-white/20 p-6 space-y-6 overflow-hidden">
                            <div className="text-center">
                                <h2 className="font-label-caps text-on-surface-variant tracking-[0.2em] font-bold">CALCULATION RESULT</h2>
                                <div className="inline-flex mt-2 px-3 py-1 bg-surface-container-high rounded-full border border-white/5">
                                    <span className="font-label-caps text-[10px] text-primary font-bold">
                                        Using {effectiveMileageData.mileage > 0 ? effectiveMileageData.mileage.toFixed(1) : '~'} km/L ({effectiveMileageData.source})
                                    </span>
                                </div>
                            </div>

                            {/* Verdict Banner */}
                            <div className={`border rounded-full py-3 px-6 flex items-center justify-center gap-2 ${
                                calculationResult.offerProfit > 100
                                    ? 'bg-primary/10 border-primary/20 text-primary'
                                    : calculationResult.offerProfit > 0
                                        ? 'bg-tertiary-container/10 border-tertiary/20 text-tertiary'
                                        : 'bg-error/10 border-error/20 text-error'
                            }`}>
                                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                                    {calculationResult.offerProfit > 100 ? 'check_circle' : calculationResult.offerProfit > 0 ? 'info' : 'warning'}
                                </span>
                                <span className="font-label-caps text-xs font-bold">
                                    {calculationResult.offerProfit > 100
                                        ? 'Good deal! Customer offer is profitable.'
                                        : calculationResult.offerProfit > 0
                                            ? 'Fair deal! Counter offer recommended.'
                                            : 'Bad deal! Customer offer is not profitable.'}
                                </span>
                            </div>

                            <div className="space-y-4">
                                {/* Fuel Cost Box */}
                                <div className="glass-card p-4 border-l-4 border-l-[#F5576C] bg-surface-container-low rounded-xl">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-label-caps text-[10px] text-on-surface-variant font-bold">FUEL COST</span>
                                        <span className="font-stats-numeral text-sm text-[#F5576C] font-bold">PKR {calculationResult.costPerKm.toFixed(2)}/km</span>
                                    </div>
                                    <div className="flex justify-between items-end">
                                        <span className="font-body-md text-on-surface/60 font-semibold">Total Trip Fuel</span>
                                        <span className="font-stats-numeral text-xl text-on-surface font-bold">PKR {calculationResult.fuelCost.toFixed(2)}</span>
                                    </div>
                                </div>

                                {/* Customer Offer Box */}
                                <div className="glass-card p-4 border-l-4 border-l-primary bg-surface-container-low glow-teal rounded-xl">
                                    <h3 className="font-label-caps text-[10px] text-on-surface-variant mb-3 font-bold uppercase">CUSTOMER OFFER: PKR {calculationResult.offerPrice}</h3>
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <span className="font-body-md text-on-surface/60 block text-xs font-semibold">Your Profit</span>
                                            <span className="font-stats-numeral text-2xl text-primary font-bold">PKR {calculationResult.offerProfit.toFixed(2)}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="font-stats-numeral text-sm text-primary/80 font-bold">PKR {calculationResult.offerProfitPerKm.toFixed(2)}/km</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Counter Offer Box */}
                                {calculationResult.myPrice > 0 && (
                                    <div className="glass-card p-4 border-l-4 border-l-secondary bg-surface-container-low glow-violet rounded-xl">
                                        <h3 className="font-label-caps text-[10px] text-on-surface-variant mb-3 uppercase font-bold">Your Counter: PKR {calculationResult.myPrice}</h3>
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <span className="font-body-md text-on-surface/60 block text-xs font-semibold">Potential Profit</span>
                                                <span className="font-stats-numeral text-2xl text-secondary-fixed-dim font-bold">PKR {calculationResult.myProfit.toFixed(2)}</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-stats-numeral text-sm text-secondary-fixed-dim/80 font-bold">PKR {calculationResult.myProfitPerKm.toFixed(2)}/km</span>
                                            </div>
                                        </div>
                                        {calculationResult.priceDifference > 0 && (
                                            <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center">
                                                <span className="font-label-caps text-[10px] text-secondary font-bold">EXTRA EARNING</span>
                                                <span className="font-stats-numeral text-sm text-secondary-fixed-dim font-bold">+ PKR {calculationResult.priceDifference.toFixed(2)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </main>
            </div>
        );
    };

    const renderHistory = () => {
        const rollingAvg = calculateRollingAverage(petrolEntries);
        const allTimeAvg = calculateAllTimeAverage(petrolEntries);

        const filteredEntries = petrolEntries.filter(entry => {
            const formattedDate = new Date(entry.date).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric'
            });
            const stationMatch = (entry.station || '').toLowerCase().includes(searchTerm.toLowerCase());
            const dateMatch = formattedDate.toLowerCase().includes(searchTerm.toLowerCase());
            return stationMatch || dateMatch;
        });

        const rollingAvgPct = Math.min(100, Math.round((rollingAvg / 20) * 100));
        const allTimeAvgPct = Math.min(100, Math.round((allTimeAvg / 20) * 100));

        return (
            <div className="w-full">


                <main className="px-container-padding pt-6 space-y-6 max-w-2xl mx-auto pb-24">
                    {/* Background Decorative Elements (Subtle Glows) */}
                    <div className="fixed top-1/4 -left-20 w-64 h-64 bg-primary/10 blur-[100px] rounded-full -z-10 pointer-events-none"></div>
                    <div className="fixed bottom-1/4 -right-20 w-80 h-80 bg-secondary/5 blur-[120px] rounded-full -z-10 pointer-events-none"></div>

                    {/* Component 1: Averages Strip */}
                    <section className="flex gap-element-gap">
                        {/* 5-Fill Average */}
                        <div className="glass-card flex-1 p-4 rounded-xl fuel-glow border border-white/10">
                            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-2 font-bold">5-Fill Average</p>
                            <div className="flex items-baseline gap-1">
                                <span className="font-stats-numeral text-headline-md text-primary font-bold">{rollingAvg > 0 ? rollingAvg.toFixed(1) : '0.0'}</span>
                                <span className="text-label-caps text-on-surface-variant font-bold">km/L</span>
                            </div>
                            <div className="mt-2 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-primary shadow-[0_0_8px_rgba(109,233,190,0.5)] transition-all duration-500" style={{ width: `${rollingAvgPct}%` }}></div>
                            </div>
                        </div>
                        {/* All-Time Average */}
                        <div className="glass-card flex-1 p-4 rounded-xl border border-white/10">
                            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-2 font-bold">All-Time Average</p>
                            <div className="flex items-baseline gap-1">
                                <span className="font-stats-numeral text-headline-md text-primary font-bold">{allTimeAvg > 0 ? allTimeAvg.toFixed(1) : '0.0'}</span>
                                <span className="text-label-caps text-on-surface-variant font-bold">km/L</span>
                            </div>
                            <div className="mt-2 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-primary opacity-60 transition-all duration-500" style={{ width: `${allTimeAvgPct}%` }}></div>
                            </div>
                        </div>
                    </section>

                    {/* Search Field */}
                    <div className="flex gap-sm">
                        <div className="flex-grow glass-card rounded-full px-4 py-2.5 flex items-center gap-2 border border-white/10">
                            <span className="material-symbols-outlined text-on-surface-variant animate-pulse" style={{ fontSize: '20px' }}>search</span>
                            <input 
                                className="bg-transparent border-none focus:ring-0 text-body-md font-body-md w-full placeholder:text-on-surface-variant/50 text-on-surface outline-none" 
                                placeholder="Search station or date..." 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Component 2: Entry List Header */}
                    <div className="flex items-center justify-between pt-2">
                        <h2 className="font-headline-md text-headline-md text-on-surface font-bold">Recent Logs</h2>
                        <span className="text-on-surface-variant text-[11px] font-semibold">{filteredEntries.length} entries found</span>
                    </div>

                    {/* Entry List */}
                    <div className="space-y-4">
                        {filteredEntries.length === 0 ? (
                            <div className="glass-card p-8 text-center text-on-surface-variant rounded-xl border border-white/10">
                                No fuel entries found matching your search.
                            </div>
                        ) : (
                            filteredEntries.map(entry => {
                                const dateObj = new Date(entry.date);
                                const formattedDate = dateObj.toLocaleDateString('en-IN', {
                                    day: '2-digit', month: 'short', year: 'numeric'
                                });

                                return (
                                    <div key={entry.id} className="glass-card p-4 rounded-xl transition-all duration-300 hover:bg-white/10 relative overflow-hidden border border-white/10 hover:scale-[1.01]">
                                        {entry.isEstimated && (
                                            <div className="absolute top-0 left-0 h-full w-1 bg-tertiary-container"></div>
                                        )}
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <p className="font-body-md text-body-md text-on-surface font-semibold">{formattedDate}</p>
                                                <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest mt-0.5">{entry.station || 'Premium Petrol'}</p>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-stats-numeral text-stats-numeral text-primary font-bold">
                                                        {entry.mileage > 0 ? parseFloat(entry.mileage).toFixed(1) : 'N/A'}
                                                    </span>
                                                    {entry.isEstimated ? (
                                                        <span className="text-[10px] px-2 py-0.5 border border-tertiary-container text-tertiary-container rounded-full font-bold">EST</span>
                                                    ) : (
                                                        <span className="text-[10px] px-2 py-0.5 border border-tertiary-container text-tertiary-container rounded-full font-bold amber-glow">5-AVG</span>
                                                    )}
                                                </div>
                                                <span className="text-label-caps text-on-surface-variant font-bold">km/L</span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 border-t border-white/5">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-on-surface-variant font-bold uppercase">Litres</span>
                                                <span className="font-stats-numeral text-body-md font-semibold text-white">{entry.litres.toFixed(1)}L</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-on-surface-variant font-bold uppercase">Cost</span>
                                                <span className="font-stats-numeral text-body-md text-on-surface font-semibold text-white">PKR {entry.totalCost.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-on-surface-variant font-bold uppercase">Distance</span>
                                                {entry.isEstimated ? (
                                                    <div className="flex items-center gap-1 text-tertiary-container">
                                                        <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                                        <span className="font-stats-numeral text-body-md font-semibold">{entry.kmTraveled.toFixed(0)} km</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="font-stats-numeral text-body-md font-semibold text-white">{entry.kmTraveled.toFixed(0)} km</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {entry.reserveDistance > 0 && (
                                            <div className="mt-2 text-[10px] text-error font-bold flex justify-between bg-error/10 px-2 py-1 rounded">
                                                <span>MAIN TANK: {entry.mainTankDistance?.toFixed(1)} km</span>
                                                <span>RESERVE: {entry.reserveDistance?.toFixed(1)} km</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </main>
            </div>
        );
    };

    // ==========================================
    // MAIN RENDER
    // ==========================================

    return (
        <div className="min-h-screen radial-bg pb-32">
            {/* Top Sticky Header */}
            {activeScreen !== 'fuel' && activeScreen !== 'dashboard' && activeScreen !== 'personal' && activeScreen !== 'ride' && activeScreen !== 'history' && activeScreen !== 'calculator' && (
                <header className="bg-background/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50 shadow-sm">
                    <div className="flex justify-between items-center px-container-margin py-xs w-full max-w-7xl mx-auto h-16">
                        <div className="flex items-center gap-sm">
                            <div className="w-10 h-10 rounded-full border-2 border-primary overflow-hidden hover:opacity-80 transition-opacity cursor-pointer" onClick={() => setActiveScreen('dashboard')}>
                                <img className="w-full h-full object-cover" alt="Driver profile" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAwypJLKvxtRK9onddJsnySSnBtykPNYnwvx2kIRYVN5B9N9sof1pxLqBKclM8K00qRUiXpTiLyL-186UgoasEvyIvzgygtN-DB6Y5vP8JBUIUrj7QmwJxwaaeaKB1vo0JTL-gjr7omnSlYvyQPqqaGs_9qNNaoSUkCFrQoMfX4rkgKpHsbGiGC1EhX1Yxhfq_5FUJKJPyp1dAWp7TFxZeMa-KobvUICl3iX0JMw6kBGG6b41imZMMnrA" />
                            </div>
                            <h1 className="font-display-lg text-headline-md bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-container tracking-tight font-bold">Petrol Tracker</h1>
                        </div>
                        <div className="flex items-center gap-xs">
                            <button className="relative p-xs hover:opacity-80 transition-opacity active:scale-95 transition-transform" onClick={handleResetRequest} title="Reset Data">
                                <span className="material-symbols-outlined text-error">restart_alt</span>
                            </button>
                            <button className="relative p-xs hover:opacity-80 transition-opacity active:scale-95 transition-transform" onClick={exportData} title="Export Data">
                                <span className="material-symbols-outlined text-primary">download</span>
                            </button>
                        </div>
                    </div>
                </header>
            )}

            {/* PWA Install Alert Overlay if canInstall is true and showInstallPrompt is true */}
            {showInstallPrompt && canInstall && (
                <div className="fixed top-0 left-0 right-0 z-[60] p-xs transition-transform duration-500 translate-y-0">
                    <div className="bg-primary/10 border border-primary/20 backdrop-blur-md rounded-xl p-md flex items-center justify-between shadow-lg">
                        <div className="flex items-center gap-md" onClick={handleInstallClick}>
                            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center shadow-primary/20 shadow-md">
                                <span className="material-symbols-outlined text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>directions_car</span>
                            </div>
                            <div>
                                <p className="font-label-md text-label-md text-primary font-bold">Install Petrol Tracker</p>
                                <p className="font-label-sm text-label-sm text-on-surface-variant">Tap here to install as PWA app.</p>
                            </div>
                        </div>
                        <button className="p-xs hover:bg-white/5 rounded-full transition-colors" onClick={() => setShowInstallPrompt(false)}>
                            <span className="material-symbols-outlined text-on-surface-variant">close</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Modals & Dialogs */}
            
            {/* 1. Reset Confirmation Modal */}
            {showResetConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-container-padding">
                    {/* High-Urgency Reset Confirmation Popup */}
                    <div className="relative glass-red coral-glow border border-coral-red/30 rounded-[32px] w-full max-w-sm p-8 flex flex-col items-center text-center animate-zoom-in-fade relative">
                        {/* Warning Header */}
                        <div className="flex items-center gap-2 mb-stack-margin">
                            <span className="material-symbols-outlined text-coral-red text-headline-md animate-pulse-slow" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                            <h2 className="font-headline-md text-headline-md text-on-surface font-bold">Confirm Reset</h2>
                        </div>
                        {/* Body Content */}
                        <div className="mb-section-margin">
                            <h1 className="font-headline-lg text-headline-lg mb-2 font-bold">Delete all data?</h1>
                            <p className="font-body-lg text-body-lg text-coral-red font-bold">Cannot be undone!</p>
                        </div>
                        {/* Descriptive Text */}
                        <p className="text-on-surface-variant font-body-md mb-8 leading-relaxed">
                            This will permanently wipe your ride history, fuel logs, and saved vehicle profiles. Are you absolutely sure?
                        </p>
                        {/* Action Cluster */}
                        <div className="flex flex-col gap-4 w-full">
                            {/* Primary: Solid Coral-Red (Delete) */}
                            <button 
                                className="w-full py-4 px-8 rounded-2xl bg-coral-red text-white font-headline-md text-headline-md shadow-[0_4px_20px_rgba(255,95,95,0.4)] hover:brightness-110 active:scale-95 transition-all duration-200 cursor-pointer font-bold"
                                onClick={confirmReset}
                            >
                                Yes, Delete
                            </button>
                            {/* Secondary: Cancel (Ghost & Large) */}
                            <button 
                                className="w-full py-4 px-8 rounded-2xl border border-white/10 font-headline-md text-headline-md text-on-surface hover:bg-white/5 active:scale-95 transition-all duration-200 cursor-pointer"
                                onClick={cancelReset}
                            >
                                Cancel
                            </button>
                        </div>
                        {/* Decorative Glow Element */}
                        <div className="absolute -z-10 bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-1/4 bg-coral-red/10 blur-[80px] rounded-full"></div>
                    </div>
                </div>
            )}

            {/* 2. Add Manual KM Modal */}
            {showManualEntry && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center px-container-margin overflow-hidden">
                    {/* Modal Container */}
                    <div className="relative w-full max-w-sm z-10 animate-zoom-in-fade">
                        {/* Main Card */}
                        <div className="glass-card bg-surface-container-lowest rounded-[32px] p-8 flex flex-col items-center teal-glow-border relative overflow-hidden">
                            {/* Atmospheric Glow Background Inside Card */}
                            <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 blur-[80px] rounded-full"></div>
                            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-secondary/10 blur-[80px] rounded-full"></div>
                            
                            {/* Header Section */}
                            <div className="text-center mb-stack-margin relative z-10">
                                <h1 className="font-headline-md text-headline-md text-on-surface mb-2">
                                    ✏️ Add Manual KM
                                </h1>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-[240px] mx-auto">
                                    Enter distance when someone else rode.
                                </p>
                            </div>

                            {/* Kilometers Input Group */}
                            <div className="w-full flex flex-col items-center mb-10 relative z-10">
                                <div className="relative group w-full">
                                    <input 
                                        autoFocus
                                        className="bg-transparent border-b-2 border-primary/30 focus:border-primary text-center font-display-hero text-[64px] w-full py-2 text-primary placeholder-primary/20 transition-all duration-300 appearance-none focus:ring-0 focus:outline-none" 
                                        placeholder="0.0" 
                                        style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800 }}
                                        type="number"
                                        value={manualKm}
                                        onChange={(e) => setManualKm(e.target.value.replace(/[^0-9.]/g, ''))}
                                    />
                                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-label-caps text-label-caps text-primary/60 tracking-[0.2em] whitespace-nowrap">
                                        KILOMETERS
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="w-full space-y-4 relative z-10">
                                {/* Primary Action */}
                                <button 
                                    className="w-full h-[64px] primary-gradient rounded-2xl flex items-center justify-center gap-2 text-on-primary font-body-lg text-body-lg btn-press transition-transform shadow-lg shadow-primary/20 cursor-pointer active:scale-97"
                                    onClick={saveManualKm}
                                >
                                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                    Add KM
                                </button>
                                {/* Ghost Action */}
                                <button 
                                    className="w-full h-[56px] bg-transparent border border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant font-body-md text-body-md btn-press transition-all hover:bg-white/5 active:bg-white/10 cursor-pointer active:scale-97"
                                    onClick={cancelManualEntry}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>

                        {/* Decorative Info Pill */}
                        <div className="mt-6 flex justify-center">
                            <div className="glass-card px-4 py-2 rounded-full border border-white/5 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                <span className="font-label-caps text-label-caps text-on-surface-variant/80 uppercase">Personal ride record</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 2b. Add Manual Reserve Modal */}
            {showAddReserveModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center px-container-margin overflow-hidden">
                    {/* Modal Container */}
                    <div className="relative w-full max-w-sm z-10 animate-zoom-in-fade">
                        {/* Main Card */}
                        <div className="glass-card bg-surface-container-lowest rounded-[32px] p-8 flex flex-col items-center teal-glow-border relative overflow-hidden">
                            {/* Atmospheric Glow Background Inside Card */}
                            <div className="absolute -top-20 -right-20 w-40 h-40 bg-error/10 blur-[80px] rounded-full"></div>
                            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-error-container/10 blur-[80px] rounded-full"></div>
                            
                            {/* Header Section */}
                            <div className="text-center mb-stack-margin relative z-10">
                                <h1 className="font-headline-md text-headline-md text-on-surface mb-2">
                                    ⛽ Add Reserve
                                </h1>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-[240px] mx-auto">
                                    Enter distance ridden on reserve.
                                </p>
                            </div>

                            {/* Kilometers Input Group */}
                            <div className="w-full flex flex-col items-center mb-10 relative z-10">
                                <div className="relative group w-full">
                                    <input 
                                        autoFocus
                                        className="bg-transparent border-b-2 border-error/30 focus:border-error text-center font-display-hero text-[64px] w-full py-2 text-error placeholder-error/20 transition-all duration-300 appearance-none focus:ring-0 focus:outline-none" 
                                        placeholder="0.0" 
                                        style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800 }}
                                        type="number"
                                        value={addReserveInput}
                                        onChange={(e) => setAddReserveInput(e.target.value.replace(/[^0-9.]/g, ''))}
                                    />
                                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-label-caps text-label-caps text-error/60 tracking-[0.2em] whitespace-nowrap">
                                        KILOMETERS
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="w-full space-y-4 relative z-10">
                                {/* Primary Action */}
                                <button 
                                    className="w-full h-[64px] bg-gradient-to-r from-error to-error-container rounded-2xl flex items-center justify-center gap-2 text-white font-body-lg text-body-lg btn-press transition-transform shadow-lg shadow-error/20 cursor-pointer active:scale-97"
                                    onClick={saveAddReserve}
                                >
                                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                    Save Reserve
                                </button>
                                {/* Ghost Action */}
                                <button 
                                    className="w-full h-[56px] bg-transparent border border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant font-body-md text-body-md btn-press transition-all hover:bg-white/5 active:bg-white/10 cursor-pointer active:scale-97"
                                    onClick={cancelAddReserve}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Add Ride Manually Modal */}
            {showRideEntry && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center px-container-margin overflow-y-auto py-lg">
                    {/* Modal Container */}
                    <div className="relative z-10 w-full max-w-sm animate-zoom-in-fade">
                        {/* Amber Warning Banner */}
                        <div className="mb-4 amber-warning rounded-xl p-4 flex items-center gap-3 shadow-lg">
                            <span className="material-symbols-outlined text-xl">warning</span>
                            <p className="font-body-md text-body-md">
                                {petrolEntries.length === 0 
                                    ? "Add fuel data first for accurate calculations" 
                                    : "Calculations are based on average consumption settings. Accuracy may vary."}
                            </p>
                        </div>

                        {/* Main Modal Card */}
                        <div className="glass-card bg-surface-container-lowest violet-glow-border rounded-[2rem] overflow-hidden shadow-2xl relative">
                            {/* Atmospheric Background Glows inside Card */}
                            <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-primary/10 blur-[100px] rounded-full pointer-events-none"></div>
                            <div className="absolute -top-20 -right-20 w-64 h-64 bg-secondary/10 blur-[100px] rounded-full pointer-events-none"></div>
                            
                            {/* Header Section */}
                            <div className="px-8 pt-8 pb-6 border-b border-white/5 relative z-10">
                                <div className="flex justify-between items-start mb-2">
                                    <h1 className="font-headline-md text-headline-md text-on-surface">🚖 Add Ride Manually</h1>
                                    <button 
                                        className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                                        onClick={cancelRideEntry}
                                    >
                                        <span className="material-symbols-outlined">close</span>
                                    </button>
                                </div>
                                <p className="font-body-md text-body-md text-on-surface-variant/80">Manual entry (without GPS tracking).</p>
                            </div>

                            {/* Form Content */}
                            <div className="px-8 py-6 space-y-6 relative z-10">
                                {/* Distance Input */}
                                <div className="space-y-2">
                                    <label className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider">Distance (km)</label>
                                    <div className="relative group">
                                        <input 
                                            className="w-full input-dark rounded-xl px-4 py-4 font-stats-numeral text-stats-numeral text-primary placeholder-primary/20 focus:ring-0 focus:outline-none" 
                                            placeholder="0.0" 
                                            step="0.1" 
                                            type="number"
                                            value={rideKm}
                                            onChange={(e) => setRideKm(e.target.value)}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                                            <span className="material-symbols-outlined">route</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Base Fare Input */}
                                <div className="space-y-2">
                                    <label className="font-label-caps text-label-caps text-on-surface-variant block uppercase tracking-wider">Base Fare (PKR)</label>
                                    <div className="relative group">
                                        <input 
                                            className="w-full input-dark rounded-xl px-4 py-4 font-stats-numeral text-stats-numeral text-on-surface placeholder-on-surface/20 focus:ring-0 focus:outline-none" 
                                            placeholder="0.00" 
                                            type="number"
                                            value={rideEarnings}
                                            onChange={(e) => setRideEarnings(e.target.value)}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                                            <span className="material-symbols-outlined">payments</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Tip Input (Optional) */}
                                <div className="space-y-2">
                                    <label className="font-label-caps text-label-caps text-on-surface-variant flex justify-between items-center block uppercase tracking-wider">
                                        Tip (Optional 🎁)
                                        <span className="text-[10px] bg-secondary-container/30 px-2 py-0.5 rounded text-secondary font-bold">OPTIONAL</span>
                                    </label>
                                    <div className="relative group">
                                        <input 
                                            className="w-full input-dark rounded-xl px-4 py-4 font-stats-numeral text-stats-numeral text-secondary placeholder-secondary/20 focus:ring-0 focus:outline-none" 
                                            placeholder="0.00" 
                                            type="number"
                                            value={rideTip}
                                            onChange={(e) => setRideTip(e.target.value)}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                                            <span className="material-symbols-outlined">volunteer_activism</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="px-8 pb-10 pt-4 flex flex-col gap-4 relative z-10">
                                <button 
                                    className="ride-gradient w-full py-4 rounded-xl font-headline-md text-white flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all hover:brightness-110 cursor-pointer font-bold"
                                    onClick={saveRideEntry}
                                >
                                    <span>✅ Save Ride & Profit</span>
                                </button>
                                <button 
                                    className="w-full py-2 font-body-md text-on-surface-variant hover:text-on-surface transition-colors active:opacity-60 cursor-pointer"
                                    onClick={cancelRideEntry}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>

                        {/* Decorative Info Pill */}
                        <div className="mt-6 flex justify-center">
                            <div className="glass-card px-4 py-2 rounded-full border border-white/5 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                                <span className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">Synced with Cloud</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. Ride Completion Dialog Modal */}
            {showRideCompletionDialog && (
                <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center px-container-margin">
                    <div className="relative w-full max-w-[360px]">
                        <div className="violet-glow-border glass-panel rounded-[20px] overflow-hidden flex flex-col shadow-2xl">
                            <div className="px-lg pt-lg pb-md flex items-center gap-sm">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>directions_car</span>
                                </div>
                                <h1 className="font-headline-md text-headline-md text-on-surface font-bold">Complete Ride</h1>
                            </div>
                            <div className="px-lg space-y-md">
                                <div className="bg-surface-container-highest/30 rounded-xl p-md border border-white/5 flex flex-col items-center justify-center">
                                    <span className="text-on-surface-variant font-label-md text-label-md mb-1 font-semibold">Distance Covered</span>
                                    <div className="text-primary font-display-lg text-[32px] leading-tight tracking-tight font-bold">
                                        {completedRideKm.toFixed(2)} <span className="text-primary/60 font-body-lg text-body-lg">km</span>
                                    </div>
                                    {hasEstimatedSegment && (
                                        <div className="text-[11px] text-tertiary font-semibold mt-1">
                                            (GPS: {(completedRideKm - totalEstimatedKm).toFixed(2)} km + Est: {totalEstimatedKm.toFixed(2)} km)
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-sm">
                                    <div className="relative bg-surface-container-lowest border border-white/10 rounded-xl p-2">
                                        <label className="block text-[10px] font-bold text-primary/70 uppercase tracking-wider">Base Fare (PKR)</label>
                                        <input 
                                            autoFocus
                                            className="w-full bg-transparent border-none text-on-surface font-headline-md text-headline-md focus:ring-0 outline-none p-1" 
                                            placeholder="0.00" 
                                            type="number"
                                            value={rideEarnings}
                                            onChange={(e) => setRideEarnings(e.target.value)}
                                        />
                                    </div>
                                    <div className="relative bg-surface-container-lowest border border-white/10 rounded-xl p-2">
                                        <label className="block text-[10px] font-bold text-secondary/70 uppercase tracking-wider">Tip (Optional)</label>
                                        <input 
                                            className="w-full bg-transparent border-none text-on-surface font-headline-md text-headline-md focus:ring-0 outline-none p-1" 
                                            placeholder="Enter amount" 
                                            type="number"
                                            value={rideTip}
                                            onChange={(e) => setRideTip(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="mt-lg px-lg py-sm bg-tertiary/10 flex items-center gap-xs">
                                <span className="material-symbols-outlined text-tertiary text-sm" style={{ fontVariationSettings: "'wght' 600" }}>warning</span>
                                <p className="text-tertiary font-label-sm text-[11px] leading-tight">Verify fare amounts before completing. This action cannot be undone.</p>
                            </div>
                            <div className="p-lg space-y-sm">
                                <button className="bg-gradient-to-r from-secondary-container to-secondary text-on-secondary w-full py-4 rounded-xl font-headline-md text-headline-md active:scale-95 transition-transform flex items-center justify-center gap-xs font-bold" onClick={completeRideWithEarnings}>
                                    Complete Ride
                                </button>
                                <button className="w-full py-2 font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors" onClick={cancelRideCompletion}>
                                    Skip / Discard
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* GPS Signal Status Toast Overlay if isTracking but no lock */}
            {isTracking && gpsDebug.status.includes('lock') && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-40px)] max-w-md animate-slide-down">
                    <div className="amber-toast backdrop-blur-md rounded-2xl px-md py-sm flex items-center gap-sm shadow-xl">
                        <div className="relative w-6 h-6 flex items-center justify-center">
                            <span className="material-symbols-outlined text-tertiary animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>satellite_alt</span>
                        </div>
                        <div className="flex-1">
                            <p className="font-label-md text-label-md">Searching for GPS Signal...</p>
                            <p className="font-label-sm text-[10px] opacity-70">Weak connection. Ensure Location is ON.</p>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-tertiary animate-ping"></div>
                    </div>
                </div>
            )}

            {/* General GPS Status Alerts */}
            {showGpsAlert && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-40px)] max-w-md animate-slide-down" onClick={() => setShowGpsAlert(false)}>
                    <div className="p-md rounded-2xl bg-surface-container-high border border-white/10 text-on-surface flex items-center gap-xs shadow-xl">
                        <span className="material-symbols-outlined text-primary">info</span>
                        <p className="font-label-sm text-label-sm flex-1 whitespace-pre-line">{gpsMessage}</p>
                        <span className="material-symbols-outlined text-[18px] opacity-50 cursor-pointer">close</span>
                    </div>
                </div>
            )}

            {/* Screen Container */}
            <div className="container max-w-7xl mx-auto px-container-margin py-md">
                {activeScreen === 'dashboard' && renderDashboard()}
                {activeScreen === 'fuel' && renderPetrolEntry()}
                {activeScreen === 'personal' && renderPersonalTrip()}
                {activeScreen === 'ride' && renderRideTrip()}
                {activeScreen === 'calculator' && renderCalculator()}
                {activeScreen === 'history' && renderHistory()}
            </div>

            {/* Floating Bottom Navigation */}
            <nav className="fixed bottom-8 left-0 right-0 mx-auto z-50 flex justify-around items-center px-4 max-w-md">
                <div className="bg-white/10 backdrop-blur-xl border border-white/10 h-16 w-full rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] flex justify-around items-center px-2">
                    {/* Home (Dashboard) */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'dashboard' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('dashboard')}
                        title="Dashboard"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'dashboard' ? "'FILL' 1" : "'FILL' 0" }}>home</span>
                    </button>

                    {/* Fuel */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'fuel' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('fuel')}
                        title="Add Fuel"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'fuel' ? "'FILL' 1" : "'FILL' 0" }}>local_gas_station</span>
                    </button>

                    {/* Personal */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'personal' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('personal')}
                        title="Personal Trip"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'personal' ? "'FILL' 1" : "'FILL' 0" }}>person</span>
                    </button>

                    {/* Ride */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'ride' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('ride')}
                        title="Ride Earnings"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'ride' ? "'FILL' 1" : "'FILL' 0" }}>directions_car</span>
                    </button>

                    {/* Calculator */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'calculator' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('calculator')}
                        title="Fare Calculator"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'calculator' ? "'FILL' 1" : "'FILL' 0" }}>calculate</span>
                    </button>

                    {/* History */}
                    <button 
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90 ${
                            activeScreen === 'history' 
                                ? 'bg-primary-container text-on-primary-container shadow-[0_0_15px_rgba(109,233,190,0.3)]' 
                                : 'text-outline hover:text-primary'
                        }`}
                        onClick={() => setActiveScreen('history')}
                        title="History Log"
                    >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: activeScreen === 'history' ? "'FILL' 1" : "'FILL' 0" }}>history</span>
                    </button>
                </div>
            </nav>
        </div>
    );
}

export default App;
