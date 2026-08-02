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
    const [fillDate, setFillDate] = useState('');

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

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);
    const positionCountRef = useRef(0);
    const positionHistoryRef = useRef([]);
    const isFirstPositionAfterStart = useRef(true);

    // ==========================================
    // MILEAGE CALCULATION HELPERS
    // ==========================================

    const calculateRollingAverage = useCallback((entries, windowSize = MILEAGE_CONFIG.ROLLING_WINDOW) => {
        if (!entries || entries.length === 0) return 0;

        const recentEntries = entries.slice(0, Math.min(windowSize, entries.length));

        const totalDistance = recentEntries.reduce((sum, entry) => sum + (entry.kmTraveled || 0), 0);
        const totalLitres = recentEntries.reduce((sum, entry) => sum + entry.litres, 0);

        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const calculateAllTimeAverage = useCallback((entries) => {
        if (!entries || entries.length === 0) return 0;

        const totalDistance = entries.reduce((sum, entry) => sum + (entry.kmTraveled || 0), 0);
        const totalLitres = entries.reduce((sum, entry) => sum + entry.litres, 0);

        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const getEffectiveMileage = useCallback((entries) => {
        if (!entries || entries.length === 0) {
            return { mileage: 0, source: 'none', isEstimated: false };
        }

        const lastEntry = entries[0];
        const rollingAvg = calculateRollingAverage(entries);

        // Check if last tank had enough distance to be trusted
        const lastTankDistance = lastEntry.kmTraveled || 0;
        const shouldUseFallback = lastTankDistance < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD;

        if (shouldUseFallback && rollingAvg > 0 && entries.length >= 2) {
            return {
                mileage: rollingAvg,
                source: 'rolling-average',
                isEstimated: true
            };
        }

        // Use last tank's mileage if available
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

    const handleGPSError = useCallback((error) => {
        console.error('GPS Error:', error);

        let message = '';
        let status = 'Error';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '❌ GPS Permission Denied\n\nGo to Settings → Site Settings → Location';
                status = 'Permission Denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '📡 No GPS Signal\n\n• Move outdoors\n• Check if Location is ON\n• Restart device';
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
    }, [showGpsMessage]);

    const handlePositionUpdate = useCallback((position) => {
        positionCountRef.current += 1;
        const updateNum = positionCountRef.current;

        const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            timestamp: Date.now()
        };

        positionHistoryRef.current.push(newPosition);
        if (positionHistoryRef.current.length > 5) {
            positionHistoryRef.current.shift();
        }

        setGpsDebug({
            updates: updateNum,
            lastLat: position.coords.latitude,
            lastLng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            status: 'Active ✓',
            lastDistance: 0
        });

        if (isFirstPositionAfterStart.current) {
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            isFirstPositionAfterStart.current = false;
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

            if (distanceMeters < 10) {
                shouldUpdate = false;
            } else if (position.coords.accuracy > 30) {
                shouldUpdate = false;
            } else if (position.coords.speed !== null && position.coords.speed < 0.5) {
                shouldUpdate = distanceMeters >= 15;
            } else if (positionHistoryRef.current.length >= 3) {
                let totalDistance = 0;
                for (let i = 1; i < positionHistoryRef.current.length; i++) {
                    const prev = positionHistoryRef.current[i - 1];
                    const curr = positionHistoryRef.current[i];
                    totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) * 1000;
                }
                shouldUpdate = totalDistance > 20 || distanceMeters > 20;
            } else if (distanceMeters > 20) {
                shouldUpdate = true;
            } else {
                shouldUpdate = true;
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
    }, [calculateDistance]);

    // ==========================================
    // GPS TRACKING (MOVED UP FOR stopTrip dependency)
    // ==========================================

    const stopTrip = useCallback(() => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        if (currentTrip) {
            const actualKm = currentTrip.distance;

            if (currentTrip.isRide) {
                setCompletedRideKm(actualKm);
                setShowRideCompletionDialog(true);
                setIsTracking(false);
                setGpsDebug(prev => ({ ...prev, status: 'Stopped', speed: 0 }));
            } else {
                const completedTrip = {
                    ...currentTrip,
                    endTime: new Date().toISOString(),
                    isActive: false
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
    }, [currentTrip, showGpsMessage]);

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
        const targetSpeed = gpsDebug.speed * 3.6;

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
                    setRideEntries(data.rideEntries || []);
                }
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };

        const setTodayDate = () => {
            const today = new Date().toISOString().split('T')[0];
            setFillDate(today);
        };

        loadData();
        setTodayDate();
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
                    lastSaved: new Date().toISOString()
                };

                const dataString = JSON.stringify(data);

                localStorage.setItem('petrolTrackerData', dataString);
            } catch (error) {
                if (error.name === 'QuotaExceededError') {
                    const trimmedData = {
                        petrolEntries: petrolEntries.slice(0, 20),
                        trips: trips.slice(0, 50),
                        currentTrip,
                        totalKmSinceLastFill,
                        rideEntries: rideEntries.slice(0, 50),
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
    }, [petrolEntries, trips, currentTrip, totalKmSinceLastFill, rideEntries]);

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
    // PREVENT ACCIDENTAL BACK DURING TRACKING (FIXED)
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
    }, [isTracking, stopTrip]); // FIXED: Added stopTrip dependency

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

        setPetrolEntries([]);
        setTrips([]);
        setCurrentTrip(null);
        setTotalKmSinceLastFill(0);
        setRideEntries([]);
        setLitres('');
        setPricePerLitre('');
        const today = new Date().toISOString().split('T')[0];
        setFillDate(today);
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

        const tankMileage = totalKmSinceLastFill > 0
            ? (totalKmSinceLastFill / roundedLitres).toFixed(2)
            : 0;

        const isShortTank = totalKmSinceLastFill < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD && totalKmSinceLastFill > 0;

        const entry = {
            id: Date.now(),
            litres: roundedLitres,
            pricePerLitre: roundedPrice,
            totalCost: roundedLitres * roundedPrice,
            date: fillDate,
            kmTraveled: totalKmSinceLastFill,
            mileage: tankMileage,
            isEstimated: isShortTank,
            createdAt: new Date().toISOString()
        };

        setPetrolEntries(prev => [entry, ...prev]);
        setTotalKmSinceLastFill(0);
        setTrips([]);
        setLitres('');
        setPricePerLitre('');
        const today = new Date().toISOString().split('T')[0];
        setFillDate(today);

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

    const handleManualEntryRequest = () => {
        setShowManualEntry(true);
    };

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
    // RIDE ENTRY (MANUAL)
    // ==========================================

    const handleRideEntryRequest = () => {
        setShowRideEntry(true);
    };

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

            const accuracyMode = highAccuracy ? 'High Accuracy' : 'Standard';
            const tripType = isRideTrip ? '🚖 Ride' : '🏍️ Personal';
            showGpsMessage('🟢 GPS Active (' + tripType + ' - ' + accuracyMode + ')', false);
            setGpsDebug(prev => ({ ...prev, status: 'Tracking ' + tripType + ' (' + accuracyMode + ')' }));
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                lastPositionRef.current = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    speed: position.coords.speed || 0,
                    timestamp: Date.now()
                };

                positionHistoryRef.current = [lastPositionRef.current];
                startWatching(true);
            },
            (error) => {
                if (error.code === 3) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            lastPositionRef.current = {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                                accuracy: position.coords.accuracy,
                                speed: position.coords.speed || 0,
                                timestamp: Date.now()
                            };

                            positionHistoryRef.current = [lastPositionRef.current];
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
    // SPEEDOMETER COMPONENT
    // ==========================================

    const Speedometer = useMemo(() => {
        return React.memo(({ speed }) => {
            const maxSpeed = 120;
            const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
            const speedPercentage = (clampedSpeed / maxSpeed) * 100;
            const startAngle = 225;
            const rotation = startAngle + (speedPercentage / 100) * 270;

            return (
                <div className="speedometer-container">
                    <svg className="speedometer" viewBox="0 0 300 300">
                        <defs>
                            <linearGradient id="speedGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#f3557a" />
                                <stop offset="30%" stopColor="#b73fe0" />
                                <stop offset="60%" stopColor="#5a70f9" />
                                <stop offset="100%" stopColor="#5de4db" />
                            </linearGradient>
                        </defs>

                        {Array.from({ length: 9 }, (_, i) => 15 + i * 8).map((r) => (
                            <circle key={r} cx="150" cy="150" r={r} fill="none"
                                stroke="rgba(66, 230, 207, 0.07)" strokeWidth="1.5" />
                        ))}

                        <path d="M 72.22 227.78 A 110 110 0 1 1 227.78 227.78"
                            fill="none" stroke="url(#speedGradient)"
                            strokeWidth="14" strokeLinecap="round" />

                        {[
                            { speed: 0, x: 55, y: 245, label: '0' },
                            { speed: 30, x: 30, y: 100, label: '30' },
                            { speed: 60, x: 150, y: 15, label: '60' },
                            { speed: 90, x: 270, y: 100, label: '90' },
                            { speed: 120, x: 245, y: 245, label: '120' }
                        ].map(({ speed, x, y, label }) => (
                            <text key={speed} x={x} y={y} fill="#b5c0c9"
                                fontSize="24" fontWeight="400" textAnchor="middle"
                                dominantBaseline="middle"
                                style={{ fontFamily: "'Caveat', 'Kalam', cursive" }}>
                                {label}
                            </text>
                        ))}

                        <g transform={`rotate(${rotation} 150 150)`}>
                            <line x1="150" y1="170" x2="150" y2="65"
                                stroke="#42e6cf" strokeWidth="3.5" strokeLinecap="round" />
                            <circle cx="150" cy="150" r="10" fill="#42e6cf" />
                            <circle cx="150" cy="150" r="4" fill="#16213e" />
                        </g>
                    </svg>

                    <div className="speedometer-value">
                        <div className="speed-number">{clampedSpeed.toFixed(1)}</div>
                        <div className="speed-unit">km/h</div>
                    </div>
                </div>
            );
        }, (prevProps, nextProps) => {
            return Math.abs(prevProps.speed - nextProps.speed) < 0.5;
        });
    }, []);

    // ==========================================
    // RENDER FUNCTIONS (keeping all your existing render code)
    // Only including renderHistory to show the fix
    // ==========================================

    const renderDashboard = () => {
        // Your existing code - unchanged
        const monthly = getMonthlySummary;
        const lastEntry = petrolEntries[0];
        const rollingAvg = calculateRollingAverage(petrolEntries);
        const currentMileage = lastEntry && totalKmSinceLastFill > 0
            ? (totalKmSinceLastFill / lastEntry.litres).toFixed(2)
            : 'N/A';
        const mileageDelta = currentMileage !== 'N/A' && rollingAvg > 0
            ? (parseFloat(currentMileage) - rollingAvg).toFixed(1)
            : null;

        return (
            <div>
                {showInstallPrompt && canInstall && (
                    <div className="card install-prompt">
                        <h2>📱 Install App</h2>
                        <p style={{ color: '#93dac4', marginBottom: '15px', fontSize: '14px' }}>
                            Add to home screen!
                        </p>
                        <button className="btn btn-success" onClick={handleInstallClick}>
                            ⬇️ Install
                        </button>
                        <button className="btn btn-secondary" style={{ marginTop: '10px' }}
                            onClick={() => setShowInstallPrompt(false)}>
                            Later
                        </button>
                    </div>
                )}

                <div className="card">
                    <h2>🏍️ Current Tank</h2>
                    {petrolEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">⛽</div>
                            <p>No petrol entry yet!</p>
                        </div>
                    ) : (
                        <>
                            <div className="stats-grid">
                                <div className="stat-box">
                                    <div className="stat-label">Litres</div>
                                    <div className="stat-value">{lastEntry.litres}<span className="stat-unit">L</span></div>
                                </div>
                                <div className="stat-box">
                                    <div className="stat-label">Distance</div>
                                    <div className="stat-value">{totalKmSinceLastFill.toFixed(2)}<span className="stat-unit">km</span></div>
                                </div>
                                <div className="stat-box full-width">
                                    <div className="stat-label">Current Mileage</div>
                                    <div className="stat-value large">
                                        {currentMileage}
                                        <span className="stat-unit">km/L</span>
                                        {lastEntry.isEstimated && (
                                            <span className="estimation-badge">EST</span>
                                        )}
                                    </div>
                                    {mileageDelta !== null && (
                                        <div className={`mileage-trend ${parseFloat(mileageDelta) >= 0 ? 'positive' : 'negative'}`}>
                                            {parseFloat(mileageDelta) >= 0 ? '↑' : '↓'} {Math.abs(mileageDelta)} km/L vs 5-fill avg
                                        </div>
                                    )}
                                </div>
                            </div>

                            {petrolEntries.length >= 2 && rollingAvg > 0 && (
                                <div className="rolling-avg-panel">
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <span>5-Fill Average:</span>
                                        <span style={{
                                            fontSize: '18px',
                                            fontWeight: 'bold',
                                            color: '#4ecca3'
                                        }}>
                                            {rollingAvg.toFixed(2)} km/L
                                        </span>
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: '#a0b2c6',
                                        marginTop: '5px'
                                    }}>
                                        📊 Based on last {Math.min(MILEAGE_CONFIG.ROLLING_WINDOW, petrolEntries.length)} fills
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="card">
                    <h2>📊 This Month</h2>
                    <div className="stats-grid">
                        <div className="stat-box">
                            <div className="stat-label">Litres</div>
                            <div className="stat-value">{monthly.totalLitres.toFixed(1)}<span className="stat-unit">L</span></div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Spent</div>
                            <div className="stat-value" style={{ fontSize: '20px' }}>Rs. {monthly.totalSpent.toFixed(0)}</div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Distance</div>
                            <div className="stat-value">{monthly.totalKm.toFixed(0)}<span className="stat-unit">km</span></div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Avg Mileage</div>
                            <div className="stat-value">{monthly.avgMileage}<span className="stat-unit">km/L</span></div>
                        </div>
                    </div>
                </div>

                {petrolEntries.length > 0 && (
                    <div className="card">
                        <h2>⚙️ Settings</h2>
                        <button className="btn btn-secondary" onClick={exportData} style={{ marginBottom: '10px' }}>
                            📥 Export Data (JSON)
                        </button>
                        <button className="btn btn-danger" onClick={handleResetRequest}>
                            🗑️ Reset All Data
                        </button>
                        <p style={{ color: '#93dac4', fontSize: '12px', marginTop: '10px', textAlign: 'center' }}>
                            Deletes all entries
                        </p>
                    </div>
                )}
            </div>
        );
    };

    const renderPetrolEntry = () => {
        return (
            <div className="card">
                <h2>⛽ Add Petrol</h2>
                <div className="input-group">
                    <label htmlFor="litres">Litres Filled</label>
                    <input type="number" id="litres" placeholder="Enter litres"
                        step="0.01" min="0" value={litres}
                        onChange={(e) => setLitres(e.target.value)} inputMode="decimal" />
                </div>
                <div className="input-group">
                    <label htmlFor="pricePerLitre">Price per Litre (Rs.)</label>
                    <input type="number" id="pricePerLitre" placeholder="Enter price"
                        step="0.01" min="0" value={pricePerLitre}
                        onChange={(e) => setPricePerLitre(e.target.value)} inputMode="decimal" />
                </div>
                <div className="input-group">
                    <label htmlFor="fillDate">Date</label>
                    <input type="date" id="fillDate" value={fillDate}
                        onChange={(e) => setFillDate(e.target.value)} />
                </div>
                {totalKmSinceLastFill > 0 && (
                    <div className="alert">
                        📍 Distance: <strong>{totalKmSinceLastFill.toFixed(2)} km</strong>
                        {totalKmSinceLastFill < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD && (
                            <div style={{ marginTop: '8px', fontSize: '12px', color: '#f4a261' }}>
                                ⚠️ Short tank - will use 5-fill average for calculations
                            </div>
                        )}
                    </div>
                )}
                <button className="btn btn-success" onClick={savePetrolEntry}>
                    💾 Save Entry
                </button>
            </div>
        );
    };

    const renderPersonalTrip = () => {
        const currentTripKm = currentTrip && currentTrip.isActive && !currentTrip.isRide
            ? currentTrip.distance.toFixed(2)
            : '0.00';

        const lastEntry = petrolEntries[0];
        const effectiveMileageData = getEffectiveMileage(petrolEntries);

        const costPerKm = effectiveMileageData.mileage > 0 && lastEntry
            ? lastEntry.pricePerLitre / effectiveMileageData.mileage
            : 0;

        const tankCostIncurred = costPerKm * totalKmSinceLastFill;
        const currentTripDistanceVal = currentTrip && currentTrip.isActive && !currentTrip.isRide ? currentTrip.distance : 0;
        const tripCostIncurred = costPerKm * currentTripDistanceVal;
        const totalTankCost = lastEntry ? lastEntry.totalCost : 0;
        const remainingFuelValue = Math.max(0, totalTankCost - tankCostIncurred);

        const isPersonalTripActive = isTracking && currentTrip && !currentTrip.isRide;

        return (
            <div>
                <div className="card">
                    <h2>🏍️ Personal Trip</h2>

                    {isPersonalTripActive && <Speedometer speed={smoothSpeed} />}

                    {isPersonalTripActive && (
                        <div className="trip-type-badge" style={{
                            background: 'linear-gradient(135deg, #4ecca3 0%, #3baf84 100%)',
                            padding: '10px 15px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            marginBottom: '15px',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '14px'
                        }}>
                            🏍️ PERSONAL TRIP IN PROGRESS
                        </div>
                    )}

                    <div style={{
                        background: isPersonalTripActive ? 'linear-gradient(135deg, #1a4d6d 0%, #0f3460 100%)' : '#0f3460',
                        padding: '12px',
                        borderRadius: '10px',
                        marginBottom: '15px',
                        border: `2px solid ${isPersonalTripActive ? '#4ecca3' : '#1a4d6d'}`,
                        fontSize: '12px'
                    }}>
                        <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
                            📡 {gpsDebug.status}
                        </div>
                        {isPersonalTripActive && (
                            <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5' }}>
                                Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span> |
                                Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                                    {gpsDebug.accuracy.toFixed(0)}m
                                </span>
                            </div>
                        )}
                    </div>

                    {isPersonalTripActive && gpsDebug.accuracy > 50 && (
                        <div style={{
                            background: 'rgba(238, 108, 77, 0.1)',
                            border: '1px solid #ee6c4d',
                            borderRadius: '8px',
                            padding: '10px',
                            marginBottom: '15px',
                            fontSize: '12px',
                            color: '#f4a261'
                        }}>
                            ⚠️ Poor GPS accuracy ({gpsDebug.accuracy.toFixed(0)}m)
                            <br />Move to open area for better tracking
                        </div>
                    )}

                    <div className="trip-status-grid">
                        <div className={`trip-status-compact ${isPersonalTripActive ? 'tracking' : ''}`}>
                            <div className="trip-label-small">CURRENT TRIP</div>
                            <div className="trip-value-small">{currentTripKm} km</div>
                        </div>
                        <div className="trip-status-compact">
                            <div className="trip-label-small">TOTAL</div>
                            <div className="trip-value-small">{totalKmSinceLastFill.toFixed(2)} km</div>
                        </div>
                    </div>

                    {!isPersonalTripActive ? (
                        <>
                            <button className="btn btn-success btn-lg btn-personal-trip" onClick={() => startGPSTracking(false)}>
                                ▶️ START PERSONAL TRIP
                            </button>
                            <button className="btn btn-secondary btn-lg" style={{ marginTop: '10px' }}
                                onClick={handleManualEntryRequest}>
                                ✏️ ADD MANUAL KM
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-danger btn-lg" onClick={stopTrip}>
                            ⏹️ STOP TRIP
                        </button>
                    )}

                    {showGpsAlert && (
                        <div className="alert alert-warning" style={{ marginTop: '15px' }}>
                            {gpsMessage}
                        </div>
                    )}
                </div>

                <div className="card cost-panel-card">
                    <h2>💰 Fuel Expense (Current Fill)</h2>
                    {petrolEntries.length === 0 ? (
                        <div className="empty-state-compact">
                            <p style={{ color: '#93dac4', fontSize: '13px', margin: 0 }}>
                                💡 Add a petrol fill entry in the <strong>Fuel</strong> tab!
                            </p>
                        </div>
                    ) : (
                        <>
                            {effectiveMileageData.isEstimated && (
                                <div style={{
                                    background: 'rgba(244, 162, 97, 0.1)',
                                    border: '1px solid #f4a261',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    marginBottom: '12px',
                                    fontSize: '11px',
                                    color: '#f4a261',
                                    textAlign: 'center'
                                }}>
                                    ℹ️ Using 5-fill average ({effectiveMileageData.mileage.toFixed(2)} km/L) - last tank was short
                                </div>
                            )}
                            <div className="cost-grid">
                                <div className="cost-box highlight">
                                    <div className="cost-label">TANK SPENT</div>
                                    <div className="cost-value">Rs. {tankCostIncurred.toFixed(1)}</div>
                                    <div className="cost-subtext">of Rs. {totalTankCost.toFixed(0)} filled</div>
                                </div>
                                <div className="cost-box">
                                    <div className="cost-label">TRIP COST</div>
                                    <div className="cost-value">Rs. {tripCostIncurred.toFixed(1)}</div>
                                    <div className="cost-subtext">{currentTripDistanceVal.toFixed(1)} km trip</div>
                                </div>
                                <div className="cost-box">
                                    <div className="cost-label">COST / KM</div>
                                    <div className="cost-value">Rs. {costPerKm.toFixed(2)}</div>
                                    <div className="cost-subtext">per km driven</div>
                                </div>
                                <div className="cost-box">
                                    <div className="cost-label">FUEL LEFT VALUE</div>
                                    <div className="cost-value" style={{ color: remainingFuelValue > 0 ? '#4ecca3' : '#ee6c4d' }}>
                                        Rs. {remainingFuelValue.toFixed(1)}
                                    </div>
                                    <div className="cost-subtext">est. remaining</div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    };

    const renderRideTrip = () => {
        const rideSummary = getRideSummary;
        const currentRideTripKm = currentTrip && currentTrip.isActive && currentTrip.isRide
            ? currentTrip.distance.toFixed(2)
            : '0.00';

        const isRideTripActive = isTracking && currentTrip && currentTrip.isRide;

        return (
            <div>
                <div className="card">
                    <h2>🚖 Ride Trip</h2>

                    {isRideTripActive && <Speedometer speed={smoothSpeed} />}

                    {isRideTripActive && (
                        <div className="trip-type-badge" style={{
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            padding: '10px 15px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            marginBottom: '15px',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '14px'
                        }}>
                            🚖 RIDE TRIP IN PROGRESS
                        </div>
                    )}

                    <div style={{
                        background: isRideTripActive ? 'linear-gradient(135deg, #1a4d6d 0%, #0f3460 100%)' : '#0f3460',
                        padding: '12px',
                        borderRadius: '10px',
                        marginBottom: '15px',
                        border: `2px solid ${isRideTripActive ? '#4ecca3' : '#1a4d6d'}`,
                        fontSize: '12px'
                    }}>
                        <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
                            📡 {gpsDebug.status}
                        </div>
                        {isRideTripActive && (
                            <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5' }}>
                                Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span> |
                                Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                                    {gpsDebug.accuracy.toFixed(0)}m
                                </span>
                            </div>
                        )}
                    </div>

                    {isRideTripActive && gpsDebug.accuracy > 50 && (
                        <div style={{
                            background: 'rgba(238, 108, 77, 0.1)',
                            border: '1px solid #ee6c4d',
                            borderRadius: '8px',
                            padding: '10px',
                            marginBottom: '15px',
                            fontSize: '12px',
                            color: '#f4a261'
                        }}>
                            ⚠️ Poor GPS accuracy ({gpsDebug.accuracy.toFixed(0)}m)
                            <br />Move to open area for better tracking
                        </div>
                    )}

                    <div className="trip-status-grid">
                        <div className={`trip-status-compact ${isRideTripActive ? 'tracking' : ''}`}>
                            <div className="trip-label-small">CURRENT RIDE</div>
                            <div className="trip-value-small">{currentRideTripKm} km</div>
                        </div>
                        <div className="trip-status-compact">
                            <div className="trip-label-small">TOTAL</div>
                            <div className="trip-value-small">{totalKmSinceLastFill.toFixed(2)} km</div>
                        </div>
                    </div>

                    {!isRideTripActive ? (
                        <>
                            <button className="btn btn-primary btn-lg btn-ride-trip"
                                onClick={() => startGPSTracking(true)}>
                                ▶️ START RIDE TRIP
                                <div className="btn-subtitle">GPS tracking + earnings</div>
                            </button>
                            <button className="btn btn-secondary btn-lg" style={{ marginTop: '10px' }}
                                onClick={handleRideEntryRequest}>
                                ✏️ ADD RIDE MANUALLY
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-danger btn-lg" onClick={stopTrip}>
                            ⏹️ COMPLETE RIDE
                        </button>
                    )}

                    {showGpsAlert && (
                        <div className="alert alert-warning" style={{ marginTop: '15px' }}>
                            {gpsMessage}
                        </div>
                    )}
                </div>

                <div className="card ride-summary-card">
                    <h2>💰 Monthly Earnings</h2>
                    {rideEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">🚖</div>
                            <p>No rides yet this month</p>
                        </div>
                    ) : (
                        <div className="stats-grid">
                            <div className="stat-box">
                                <div className="stat-label">Total Rides</div>
                                <div className="stat-value" style={{ fontSize: '28px' }}>{rideSummary.totalRides}</div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Distance</div>
                                <div className="stat-value">{rideSummary.totalRideKm.toFixed(0)}<span className="stat-unit">km</span></div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Earnings</div>
                                <div className="stat-value" style={{ fontSize: '20px', color: '#4ecca3' }}>Rs. {rideSummary.totalEarnings.toFixed(0)}</div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Tips 🎁</div>
                                <div className="stat-value" style={{ fontSize: '20px', color: '#f4a261' }}>Rs. {rideSummary.totalTips.toFixed(0)}</div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Fuel Cost</div>
                                <div className="stat-value" style={{ fontSize: '20px', color: '#ee6c4d' }}>Rs. {rideSummary.totalFuelCost.toFixed(0)}</div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Avg Profit/Ride</div>
                                <div className="stat-value" style={{ fontSize: '20px', color: '#4ecca3' }}>Rs. {rideSummary.avgProfitPerRide.toFixed(0)}</div>
                            </div>
                            <div className="stat-box full-width profit-box">
                                <div className="stat-label">💰 NET PROFIT</div>
                                <div className="stat-value large" style={{ color: rideSummary.totalProfit > 0 ? '#4ecca3' : '#ee6c4d' }}>
                                    Rs. {rideSummary.totalProfit.toFixed(2)}
                                </div>
                                <div style={{ color: '#93dac4', fontSize: '12px', marginTop: '5px' }}>
                                    Rs. {rideSummary.avgProfitPerKm.toFixed(2)}/km
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h2>📜 Ride History</h2>
                    {rideEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">🚗</div>
                            <p>No ride entries yet</p>
                        </div>
                    ) : (
                        <div>
                            {rideEntries.slice(0, 10).map(ride => {
                                const date = new Date(ride.date);
                                const formattedDate = date.toLocaleDateString('en-IN', {
                                    day: '2-digit', month: 'short', year: 'numeric'
                                });
                                const formattedTime = date.toLocaleTimeString('en-IN', {
                                    hour: '2-digit', minute: '2-digit'
                                });

                                return (
                                    <div key={ride.id} className="history-item"
                                        style={{ borderLeft: `4px solid ${ride.profit > 0 ? '#4ecca3' : '#ee6c4d'}` }}>
                                        <div className="history-header">
                                            <div className="history-date">{formattedDate} • {formattedTime}</div>
                                            <div className="history-mileage"
                                                style={{
                                                    color: ride.profit > 0 ? '#4ecca3' : '#ee6c4d',
                                                    fontWeight: 'bold',
                                                    background: ride.profit > 0 ? 'rgba(78, 204, 163, 0.2)' : 'rgba(238, 108, 77, 0.2)',
                                                    border: `1px solid ${ride.profit > 0 ? '#4ecca3' : '#ee6c4d'}`
                                                }}>
                                                Rs. {ride.profit.toFixed(2)}
                                            </div>
                                        </div>
                                        <div className="history-details">
                                            <div className="history-detail">
                                                Distance: <span>{ride.km.toFixed(1)} km</span>
                                            </div>
                                            <div className="history-detail">
                                                Fare: <span style={{ color: '#4ecca3' }}>Rs. {ride.earnings.toFixed(0)}</span>
                                            </div>
                                            {ride.tip > 0 && (
                                                <div className="history-detail">
                                                    Tip: <span style={{ color: '#f4a261' }}>Rs. {ride.tip.toFixed(0)} 🎁</span>
                                                </div>
                                            )}
                                            <div className="history-detail">
                                                Total: <span style={{ color: '#4ecca3' }}>Rs. {ride.totalEarnings.toFixed(0)}</span>
                                            </div>
                                            <div className="history-detail">
                                                Fuel: <span>{ride.fuelUsed.toFixed(2)} L</span>
                                            </div>
                                            <div className="history-detail">
                                                Cost: <span style={{ color: '#ee6c4d' }}>Rs. {ride.fuelCost.toFixed(2)}</span>
                                            </div>
                                        </div>
                                        <div style={{
                                            marginTop: '8px', padding: '8px',
                                            background: 'rgba(66, 230, 207, 0.1)',
                                            borderRadius: '6px', fontSize: '11px', color: '#93dac4'
                                        }}>
                                            💰 Profit/km: Rs. {ride.profitPerKm.toFixed(2)} | Cost/km: Rs. {ride.costPerKm.toFixed(2)}
                                            {ride.mileageSource === 'rolling-average' && (
                                                <span className="estimation-badge" style={{ marginLeft: '6px' }}>
                                                    5-AVG
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderCalculator = () => {
        return (
            <div>
                <div className="card">
                    <h2>🧮 Fare Calculator</h2>
                    <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                        Compare offers and negotiate better rates!
                    </p>

                    <div className="input-group">
                        <label htmlFor="calcKm">Distance (km)</label>
                        <input type="number" id="calcKm" placeholder="e.g., 20"
                            step="0.1" min="0" value={calcKm}
                            onChange={(e) => setCalcKm(e.target.value)}
                            inputMode="decimal"
                            style={{ fontSize: '16px', padding: '12px' }} />
                    </div>

                    <div className="input-group">
                        <label htmlFor="calcOffer">Customer Offer (Rs.)</label>
                        <input type="number" id="calcOffer" placeholder="e.g., 350"
                            step="1" min="0" value={calcOffer}
                            onChange={(e) => setCalcOffer(e.target.value)}
                            inputMode="decimal"
                            style={{ fontSize: '16px', padding: '12px' }} />
                    </div>

                    <div className="input-group">
                        <label htmlFor="calcMyPrice">Your Counter Offer (Rs.) - Optional</label>
                        <input type="number" id="calcMyPrice" placeholder="e.g., 400"
                            step="1" min="0" value={calcMyPrice}
                            onChange={(e) => setCalcMyPrice(e.target.value)}
                            inputMode="decimal"
                            style={{ fontSize: '16px', padding: '12px' }} />
                    </div>

                    {petrolEntries.length === 0 && (
                        <div className="modal-warning">
                            ⚠️ Add fuel data first for accurate calculations
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn btn-success btn-calculator" onClick={calculateFare} style={{ flex: 1 }}>
                            🧮 Calculate
                        </button>
                        <button className="btn btn-secondary" onClick={clearCalculator} style={{ flex: 1 }}>
                            🔄 Clear
                        </button>
                    </div>
                </div>

                {calculationResult && (
                    <div className="card calc-result-section">
                        <div className="calc-section-header">
                            📊 CALCULATION RESULT
                        </div>

                        <div style={{
                            fontSize: '11px',
                            color: '#93dac4',
                            textAlign: 'center',
                            marginBottom: '12px',
                            padding: '6px',
                            background: 'rgba(15, 52, 96, 0.5)',
                            borderRadius: '6px'
                        }}>
                            Using {calculationResult.mileageValue.toFixed(2)} km/L
                            ({calculationResult.isEstimated ? '5-fill average' : 'current tank'})
                        </div>

                        <div className="calc-fuel-box">
                            <div style={{ fontSize: '12px', color: '#93dac4', marginBottom: '8px', fontWeight: 'bold' }}>
                                ⛽ FUEL COST
                            </div>
                            <div className="calc-comparison-row">
                                <span className="calc-comparison-label">Cost/km:</span>
                                <span className="calc-comparison-value" style={{ color: '#ee6c4d' }}>Rs. {calculationResult.costPerKm.toFixed(2)}</span>
                            </div>
                            <div className="calc-comparison-row">
                                <span className="calc-comparison-label">Total Fuel Cost:</span>
                                <span className="calc-comparison-value" style={{ color: '#ee6c4d' }}>Rs. {calculationResult.fuelCost.toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="calc-offer-box">
                            <div style={{ fontSize: '12px', color: '#93dac4', marginBottom: '8px', fontWeight: 'bold' }}>
                                💵 CUSTOMER OFFER: Rs. {calculationResult.offerPrice}
                            </div>
                            <div className="calc-comparison-row" style={{ marginTop: '10px' }}>
                                <span className="calc-comparison-label">Your Profit:</span>
                                <span className={`calc-comparison-value calc-profit-large ${calculationResult.offerProfit > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}`}>
                                    Rs. {calculationResult.offerProfit.toFixed(2)}
                                </span>
                            </div>
                            <div className="calc-comparison-row" style={{ marginTop: '8px' }}>
                                <span className="calc-comparison-label">Per km:</span>
                                <span className={calculationResult.offerProfitPerKm > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}>
                                    Rs. {calculationResult.offerProfitPerKm.toFixed(2)}/km
                                </span>
                            </div>
                        </div>

                        {calculationResult.myPrice > 0 && (
                            <div className="calc-counter-box">
                                <div style={{ fontSize: '12px', color: '#93dac4', marginBottom: '8px', fontWeight: 'bold' }}>
                                    🎯 YOUR COUNTER: Rs. {calculationResult.myPrice}
                                </div>
                                <div className="calc-comparison-row" style={{ marginTop: '10px' }}>
                                    <span className="calc-comparison-label">Your Profit:</span>
                                    <span className={`calc-comparison-value calc-profit-large ${calculationResult.myProfit > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}`}>
                                        Rs. {calculationResult.myProfit.toFixed(2)}
                                    </span>
                                </div>
                                <div className="calc-comparison-row" style={{ marginTop: '8px' }}>
                                    <span className="calc-comparison-label">Per km:</span>
                                    <span className={calculationResult.myProfitPerKm > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}>
                                        Rs. {calculationResult.myProfitPerKm.toFixed(2)}/km
                                    </span>
                                </div>

                                <div className="calc-divider">
                                    <div className="calc-extra-earning">
                                        <span className="calc-comparison-label">Extra Earning:</span>
                                        <span className={`calc-comparison-value ${calculationResult.priceDifference > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}`}>
                                            {calculationResult.priceDifference > 0 ? '+' : ''}Rs. {calculationResult.priceDifference.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="calc-extra-earning">
                                        <span className="calc-comparison-label">Extra Profit:</span>
                                        <span className={`calc-comparison-value ${calculationResult.profitDifference > 0 ? 'calc-profit-positive' : 'calc-profit-negative'}`}>
                                            {calculationResult.profitDifference > 0 ? '+' : ''}Rs. {calculationResult.profitDifference.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={`calc-recommendation ${calculationResult.offerProfitPerKm >= 10 ? 'good' : 'bad'}`}>
                            {calculationResult.offerProfitPerKm >= 10 ? (
                                <>
                                    <span className="calc-checkmark">✅</span>
                                    Good deal! Customer offer is profitable.
                                </>
                            ) : (
                                <>
                                    <span className="calc-warning">⚠️</span>
                                    Low profit! Consider negotiating higher.
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderHistory = () => {
        const rollingAvg = calculateRollingAverage(petrolEntries);
        const allTimeAvg = MILEAGE_CONFIG.ENABLE_ALL_TIME_AVG
            ? calculateAllTimeAverage(petrolEntries)
            : null;

        return (
            <div>
                <div className="card">
                    <h2>📜 Fuel History</h2>

                    {petrolEntries.length >= 2 && (
                        <div style={{
                            background: '#0f3460',
                            padding: '12px',
                            borderRadius: '10px',
                            marginBottom: '15px',
                            border: '1px solid #1a4d6d'
                        }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: allTimeAvg ? 'repeat(2, 1fr)' : '1fr',
                                gap: '10px',
                                fontSize: '13px'
                            }}>
                                <div>
                                    <div style={{ color: '#93dac4', marginBottom: '5px' }}>
                                        5-Fill Average
                                    </div>
                                    <div style={{ color: '#4ecca3', fontSize: '20px', fontWeight: 'bold' }}>
                                        {rollingAvg.toFixed(2)} km/L
                                    </div>
                                </div>
                                {allTimeAvg && (
                                    <div>
                                        <div style={{ color: '#93dac4', marginBottom: '5px' }}>
                                            All-Time Average
                                        </div>
                                        <div style={{ color: '#4ecca3', fontSize: '20px', fontWeight: 'bold' }}>
                                            {allTimeAvg.toFixed(2)} km/L
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {petrolEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📋</div>
                            <p>No entries yet</p>
                        </div>
                    ) : (
                        <div>
                            {petrolEntries.map(entry => {
                                const date = new Date(entry.date);
                                const formattedDate = date.toLocaleDateString('en-IN', {
                                    day: '2-digit', month: 'short', year: 'numeric'
                                });

                                return (
                                    <div key={entry.id} className="history-item">
                                        <div className="history-header">
                                            <div className="history-date">{formattedDate}</div>
                                            <div className="history-mileage">
                                                {entry.mileage > 0 ? entry.mileage : 'N/A'} km/L
                                                {entry.isEstimated && (
                                                    <span className="estimation-badge">EST</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="history-details">
                                            <div className="history-detail">
                                                Litres: <span>{entry.litres}L</span>
                                            </div>
                                            <div className="history-detail">
                                                Cost: <span>Rs. {entry.totalCost.toFixed(0)}</span>
                                            </div>
                                            <div className="history-detail">
                                                Dist: <span>{entry.kmTraveled.toFixed(1)} km</span>
                                                {entry.kmTraveled < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD && entry.kmTraveled > 0 && (
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: '#f4a261',
                                                        marginLeft: '4px'
                                                    }}>
                                                        ⚠️
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ==========================================
    // MAIN RENDER
    // ==========================================

    return (
        <div className="App">
            {showRideCompletionDialog && (
                <div className="modal-overlay">
                    <div className="modal ride-modal">
                        <h2>🚖 Complete Ride</h2>
                        <div className="ride-completion-distance">
                            <div className="ride-completion-label">Distance Covered</div>
                            <div className="ride-completion-value">{completedRideKm.toFixed(2)} km</div>
                        </div>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>
                            Enter your ride earnings
                        </p>
                        <div className="input-group">
                            <label htmlFor="rideEarnings">Base Fare (Rs.)</label>
                            <input type="number" id="rideEarnings" placeholder="e.g., 300"
                                step="1" min="0" value={rideEarnings}
                                onChange={(e) => setRideEarnings(e.target.value)}
                                inputMode="decimal" autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        <div className="input-group tip-input-wrapper">
                            <label htmlFor="rideTip">Tip (Optional) 🎁</label>
                            <input type="number" id="rideTip" placeholder="e.g., 50"
                                step="1" min="0" value={rideTip}
                                onChange={(e) => setRideTip(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        {petrolEntries.length === 0 && (
                            <div className="modal-warning">
                                ⚠️ Add a fuel entry first for accurate profit calculation
                            </div>
                        )}
                        <div className="modal-buttons">
                            <button className="btn btn-success" onClick={completeRideWithEarnings}>
                                ✅ Complete Ride
                            </button>
                            <button className="btn btn-secondary" onClick={cancelRideCompletion}>
                                Skip
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRideEntry && (
                <div className="modal-overlay">
                    <div className="modal ride-modal">
                        <h2>🚖 Add Ride Manually</h2>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                            Manual entry (without GPS tracking)
                        </p>
                        <div className="input-group">
                            <label htmlFor="rideKm">Distance (km)</label>
                            <input type="number" id="rideKm" placeholder="e.g., 15"
                                step="0.1" min="0" value={rideKm}
                                onChange={(e) => setRideKm(e.target.value)}
                                inputMode="decimal" autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        <div className="input-group">
                            <label htmlFor="rideEarnings">Base Fare (Rs.)</label>
                            <input type="number" id="rideEarnings" placeholder="e.g., 300"
                                step="1" min="0" value={rideEarnings}
                                onChange={(e) => setRideEarnings(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        <div className="input-group tip-input-wrapper">
                            <label htmlFor="rideTip">Tip (Optional) 🎁</label>
                            <input type="number" id="rideTip" placeholder="e.g., 50"
                                step="1" min="0" value={rideTip}
                                onChange={(e) => setRideTip(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        {petrolEntries.length === 0 && (
                            <div className="modal-warning">
                                ⚠️ Add a fuel entry first for accurate profit calculation
                            </div>
                        )}
                        <div className="modal-buttons">
                            <button className="btn btn-success" onClick={saveRideEntry}>
                                ✅ Calculate Profit
                            </button>
                            <button className="btn btn-secondary" onClick={cancelRideEntry}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showManualEntry && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>✏️ Add Manual KM</h2>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                            Enter distance when someone else rode
                        </p>
                        <div className="input-group">
                            <label htmlFor="manualKm">Kilometers</label>
                            <input type="number" id="manualKm" placeholder="Enter km"
                                step="0.1" min="0" value={manualKm}
                                onChange={(e) => setManualKm(e.target.value)}
                                inputMode="decimal" autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }} />
                        </div>
                        <div className="modal-buttons">
                            <button className="btn btn-success" onClick={saveManualKm}>
                                ✅ Add KM
                            </button>
                            <button className="btn btn-secondary" onClick={cancelManualEntry}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showResetConfirm && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>⚠️ Confirm Reset</h2>
                        <p>Delete all data?</p>
                        <p style={{ color: '#ee6c4d', fontSize: '14px', marginTop: '10px' }}>
                            Cannot be undone!
                        </p>
                        <div className="modal-buttons">
                            <button className="btn btn-danger" onClick={confirmReset}>
                                Yes, Delete
                            </button>
                            <button className="btn btn-secondary" onClick={cancelReset}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="header">
                <h1>⛽ Petrol Tracker</h1>
                <p>Track fuel efficiency</p>
            </div>

            <div className="container">
                {activeScreen === 'dashboard' && renderDashboard()}
                {activeScreen === 'fuel' && renderPetrolEntry()}
                {activeScreen === 'personal' && renderPersonalTrip()}
                {activeScreen === 'ride' && renderRideTrip()}
                {activeScreen === 'calculator' && renderCalculator()}
                {activeScreen === 'history' && renderHistory()}
            </div>

            <div className="bottom-nav">
                <button className={`nav-btn ${activeScreen === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('dashboard')}>
                    <div className="nav-icon">🏠</div>
                    <div style={{ fontSize: '10px' }}>Home</div>
                </button>
                <button className={`nav-btn ${activeScreen === 'fuel' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('fuel')}>
                    <div className="nav-icon">⛽</div>
                    <div style={{ fontSize: '10px' }}>Fuel</div>
                </button>
                <button className={`nav-btn ${activeScreen === 'personal' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('personal')}>
                    <div className="nav-icon">🏍️</div>
                    <div style={{ fontSize: '10px' }}>Personal</div>
                </button>
                <button className={`nav-btn ${activeScreen === 'ride' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('ride')}>
                    <div className="nav-icon">🚖</div>
                    <div style={{ fontSize: '10px' }}>Ride</div>
                </button>
                <button className={`nav-btn ${activeScreen === 'calculator' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('calculator')}>
                    <div className="nav-icon">🧮</div>
                    <div style={{ fontSize: '10px' }}>Calc</div>
                </button>
                <button className={`nav-btn ${activeScreen === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('history')}>
                    <div className="nav-icon">📜</div>
                    <div style={{ fontSize: '10px' }}>History</div>
                </button>
            </div>
        </div>
    );
}

export default App;