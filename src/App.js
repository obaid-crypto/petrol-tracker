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

        const lastTankDistance = lastEntry.kmTraveled || 0;
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

    const handleGPSError = useCallback((error) => {
        console.error('GPS Error:', error);
        let message = '';
        let status = 'Error';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = 'âŒ GPS Permission Denied\n\nGo to Settings â†’ Site Settings â†’ Location';
                status = 'Permission Denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'ðŸ“¡ No GPS Signal\n\nâ€¢ Move outdoors\nâ€¢ Check if Location is ON';
                status = 'No Signal';
                break;
            case error.TIMEOUT:
                message = 'â±ï¸ GPS Timeout - Retrying...';
                status = 'Searching...';
                setGpsDebug(prev => ({ ...prev, status }));
                return;
            default:
                message = 'âš ï¸ GPS Error: ' + error.message;
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
            status: 'Active âœ“',
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

            if (distanceMeters < 1) {
                shouldUpdate = false;
            } else if (position.coords.accuracy > 100000) {
                shouldUpdate = false;
            } else if (position.coords.speed !== null && position.coords.speed < 0.5) {
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
                showGpsMessage('â¸ï¸ Personal Trip Stopped', false);
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
                    setRideEntries(data.rideEntries || []);
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
                        lastSaved: new Date().toISOString()
                    };
                    localStorage.setItem('petrolTrackerData', JSON.stringify(trimmedData));
                    alert('âš ï¸ Storage full! Trimmed old data');
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
    // PREVENT ACCIDENTAL BACK DURING TRACKING
    // ==========================================

    useEffect(() => {
        const handleBackButton = () => {
            if (isTracking) {
                const confirmStop = window.confirm('âš ï¸ Trip is running!\n\nStop trip and go back?');
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
        alert('âœ… All data reset!');
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
        alert('âœ… Data exported successfully!');
    };

    // ==========================================
    // PETROL ENTRY
    // ==========================================

    const savePetrolEntry = () => {
        const litresNum = parseFloat(litres);
        const priceNum = parseFloat(pricePerLitre);

        if (isNaN(litresNum) || !isFinite(litresNum) || litresNum <= 0) {
            alert('âŒ Please enter valid litres!');
            return;
        }

        if (isNaN(priceNum) || !isFinite(priceNum) || priceNum <= 0) {
            alert('âŒ Please enter valid price!');
            return;
        }

        if (!fillDate) {
            alert('âŒ Please select a date!');
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
        setFillDate(new Date().toISOString().split('T')[0]);

        if (isShortTank) {
            const rollingAvg = calculateRollingAverage([entry, ...petrolEntries]);
            alert(`âš ï¸ Short tank detected (${totalKmSinceLastFill.toFixed(1)} km)\n\n` +
                `Tank mileage: ${tankMileage} km/L (estimated)\n` +
                (rollingAvg > 0 ? `Using 5-fill average (${rollingAvg.toFixed(2)} km/L) for calculations.\n\n` : '\n') +
                `âœ… Entry saved!`);
        } else {
            alert('âœ… Petrol entry saved!');
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
            alert('âŒ Please enter valid kilometers!');
            return;
        }

        if (kmNum > 1000) {
            const confirmed = window.confirm('âš ï¸ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
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
        alert('âœ… ' + roundedKm + ' km added!');
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
            alert('âŒ Please enter valid kilometers!');
            return;
        }

        if (isNaN(earningsNum) || !isFinite(earningsNum) || earningsNum < 0) {
            alert('âŒ Please enter valid earnings!');
            return;
        }

        if (kmNum > 500) {
            const confirmed = window.confirm('âš ï¸ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
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

        alert(`âœ… Ride Saved!\n\n` +
            `Distance: ${roundedKm} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip} ðŸŽ\n` : '') +
            `Total Earnings: Rs. ${totalEarnings.toFixed(2)}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L ${mileageInfo}\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
            `ðŸ’° Profit: Rs. ${profit.toFixed(2)}\n` +
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
            alert('âŒ Enter valid kilometers!');
            return;
        }

        if (isNaN(offerPrice) || offerPrice < 0) {
            alert('âŒ Enter valid offer price!');
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
            alert('âŒ GPS not supported');
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
            const tripType = isRideTrip ? 'ðŸš– Ride' : 'ðŸï¸ Personal';
            showGpsMessage('ðŸŸ¢ GPS Active (' + tripType + ' - ' + accuracyMode + ')', false);
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
                            alert('âŒ GPS Failed\n\nEnable Location & go outdoors');
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
            alert('âŒ Please enter valid earnings!');
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

        alert(`âœ… Ride Completed!\n\n` +
            `Distance: ${actualKm.toFixed(2)} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip} ðŸŽ\n` : '') +
            `Total Earnings: Rs. ${totalEarnings.toFixed(2)}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L ${mileageInfo}\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
            `ðŸ’° Net Profit: Rs. ${profit.toFixed(2)}\n` +
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

        return (
            <div className="space-y-xl max-w-md mx-auto">
                {/* Top App Bar */}
                <header className="w-full pt-6 flex justify-between items-center transition-opacity duration-300">
                    <div className="flex flex-col">
                        <h1 className="font-headline-lg text-headline-lg font-extrabold text-primary">Fuel & Ride</h1>
                        <p className="font-body-md text-body-md text-on-surface-variant">Track fuel efficiency</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button 
                            className="material-symbols-outlined text-primary text-2xl hover:opacity-80 transition-opacity active:scale-95 transition-transform"
                            onClick={() => alert("No new notifications")}
                            title="Notifications"
                        >
                            notifications
                        </button>
                        <div className="w-10 h-10 rounded-full border border-primary/20 bg-surface-container-high overflow-hidden cursor-pointer hover:opacity-80 transition-opacity active:scale-95 transition-transform" onClick={() => alert("Driver Profile: App settings are managed below.")} title="Driver Profile">
                            <img 
                                className="w-full h-full object-cover" 
                                alt="Driver Profile"
                                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBLOQKXHtXXExrSkQRimHNBihV-jjRsTc47yKNxbtoPRCF6E4Zk1HkYcWUyJMIlaAon9MUVDIl0KBViE2uMUQ4XRbtJzvGQhSCVYqv-1MdWKxtrTJGEF6Ib42qwD4C37FX0-tA50HK5Q5uLhdSblTwNeCY5zlOPFRq9nPSr7NGAJFTPDnTfuDpCrj9OARH-_xgo6VM_tSCMQKUKt24X6eOvWtpvXU7PGFlg3T_kfPie631vWJ9PX2YHmg" 
                            />
                        </div>
                    </div>
                </header>

                {/* Install App Banner */}
                {showInstallPrompt && canInstall && (
                    <section className="glass-card rounded-xl p-4 flex items-center justify-between transition-all duration-500 opacity-100 translate-y-0">
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
                                className="fuel-active-gradient px-4 py-2 rounded-full font-label-caps text-label-caps text-on-primary context-glow-primary hover:opacity-90 transition-all scale-95 active:scale-90"
                                onClick={handleInstallClick}
                            >
                                Install
                            </button>
                        </div>
                    </section>
                )}

                {/* Current Tank Card */}
                <section className="glass-card rounded-2xl p-container-padding relative overflow-hidden transition-all duration-500 opacity-100 translate-y-0">
                    {/* Subtle tint glow */}
                    <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/5 blur-[40px] rounded-full"></div>
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary">local_gas_station</span>
                            <h2 className="font-headline-md text-headline-md text-on-surface">Current Tank</h2>
                        </div>
                        {trend !== null ? (
                            trend >= 0 ? (
                                <div className="bg-primary/10 px-3 py-1 rounded-full flex items-center gap-1">
                                    <span className="material-symbols-outlined text-primary text-sm">trending_up</span>
                                    <span className="text-[12px] font-bold text-primary">+{trend.toFixed(1)} km/L</span>
                                </div>
                            ) : (
                                <div className="bg-error/10 px-3 py-1 rounded-full flex items-center gap-1">
                                    <span className="material-symbols-outlined text-error text-sm">trending_down</span>
                                    <span className="text-[12px] font-bold text-error">{trend.toFixed(1)} km/L</span>
                                </div>
                            )
                        ) : (
                            <div className="bg-white/5 px-3 py-1 rounded-full flex items-center gap-1">
                                <span className="text-[12px] font-bold text-on-surface-variant">First Fill</span>
                            </div>
                        )}
                    </div>

                    {/* Hero Tile: Current Mileage */}
                    <div className="flex flex-col items-center justify-center py-6 bg-white/5 rounded-2xl border border-white/5 mb-4 relative overflow-hidden">
                        {effectiveMileageData.isEstimated && (
                            <span className="absolute top-4 right-4 bg-tertiary-container text-on-tertiary-container text-[10px] font-extrabold px-2 py-0.5 rounded">EST</span>
                        )}
                        <p className="font-label-caps text-label-caps text-outline mb-1">Current Mileage</p>
                        <div className="flex items-baseline gap-1">
                            <span className="font-display-hero text-display-hero text-primary tracking-tighter">
                                {effectiveMileageData.mileage > 0 ? effectiveMileageData.mileage.toFixed(1) : '0.0'}
                            </span>
                            <span className="font-body-md text-body-md text-primary/70">km/L</span>
                        </div>
                    </div>

                    {/* Stat Grid */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <p className="font-label-caps text-label-caps text-outline mb-1 uppercase">Litres</p>
                            <p className="font-stats-numeral text-stats-numeral text-on-surface">
                                {lastEntry ? `${lastEntry.litres.toFixed(2)} L` : '0.00 L'}
                            </p>
                        </div>
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <p className="font-label-caps text-label-caps text-outline mb-1 uppercase">Distance</p>
                            <p className="font-stats-numeral text-stats-numeral text-on-surface">
                                {totalKmSinceLastFill.toFixed(1)} km
                            </p>
                        </div>
                    </div>

                    {/* Rolling Average Row */}
                    <div className="flex items-center justify-between px-2 pt-4 border-t border-white/10">
                        <span className="font-label-caps text-label-caps text-on-surface-variant">Rolling Average</span>
                        <div className="flex gap-2 items-center">
                            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full fuel-active-gradient" style={{ width: `${rollingAvgPercent}%` }}></div>
                            </div>
                            <span className="font-stats-numeral text-[14px] text-on-surface">{rollingAvgVal.toFixed(1)} km/L</span>
                        </div>
                    </div>
                </section>

                {/* Quick Actions */}
                <section className="grid grid-cols-2 gap-4">
                    <button 
                        className="glass-card rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2 hover:bg-white/10 hover:border-primary/20 transition-all duration-200 active:scale-95 cursor-pointer" 
                        onClick={handleManualEntryRequest}
                    >
                        <span className="material-symbols-outlined text-primary text-[28px]">add_road</span>
                        <span className="font-label-caps text-label-caps text-on-surface font-semibold">Add Manual KM</span>
                    </button>
                    <button 
                        className="glass-card rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2 hover:bg-white/10 hover:border-secondary/20 transition-all duration-200 active:scale-95 cursor-pointer" 
                        onClick={handleRideEntryRequest}
                    >
                        <span className="material-symbols-outlined text-secondary text-[28px]">app_shortcut</span>
                        <span className="font-label-caps text-label-caps text-on-surface font-semibold">Log Ride Manually</span>
                    </button>
                </section>

                {/* This Month Card */}
                <section className="flex flex-col gap-4 transition-all duration-500 opacity-100 translate-y-0">
                    <div className="flex justify-between items-center">
                        <h2 className="font-headline-md text-headline-md text-on-surface">This Month</h2>
                        <button 
                            className="font-label-caps text-label-caps text-primary hover:opacity-80 transition-opacity cursor-pointer"
                            onClick={() => setActiveScreen('history')}
                        >
                            View Report
                        </button>
                    </div>
                    <div className="grid grid-cols-2 grid-rows-2 gap-4">
                        {/* Stat Tile: Litres */}
                        <div className="glass-card rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                                <span className="material-symbols-outlined text-primary text-sm">water_drop</span>
                            </div>
                            <div>
                                <p className="font-label-caps text-label-caps text-outline uppercase mb-0.5">Litres</p>
                                <p className="font-stats-numeral text-stats-numeral text-on-surface">{monthly.totalLitres.toFixed(1)} L</p>
                            </div>
                        </div>
                        {/* Stat Tile: Spent */}
                        <div className="glass-card rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
                            <div className="w-8 h-8 rounded-full bg-secondary-container/20 flex items-center justify-center mb-2">
                                <span className="material-symbols-outlined text-secondary text-sm">payments</span>
                            </div>
                            <div>
                                <p className="font-label-caps text-label-caps text-outline uppercase mb-0.5">Spent (PKR)</p>
                                <p className="font-stats-numeral text-stats-numeral text-on-surface">PKR {monthly.totalSpent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                            </div>
                        </div>
                        {/* Stat Tile: Distance */}
                        <div className="glass-card rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                                <span className="material-symbols-outlined text-primary text-sm">route</span>
                            </div>
                            <div>
                                <p className="font-label-caps text-label-caps text-outline uppercase mb-0.5">Distance</p>
                                <p className="font-stats-numeral text-stats-numeral text-on-surface">{monthly.totalKm.toFixed(1)} km</p>
                            </div>
                        </div>
                        {/* Stat Tile: Avg Mileage */}
                        <div className="glass-card rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
                            <div className="w-8 h-8 rounded-full bg-tertiary-container/20 flex items-center justify-center mb-2">
                                <span className="material-symbols-outlined text-tertiary text-sm">speed</span>
                            </div>
                            <div>
                                <p className="font-label-caps text-label-caps text-outline uppercase mb-0.5">Avg Mileage</p>
                                <p className="font-stats-numeral text-stats-numeral text-on-surface">{monthly.avgMileage} km/L</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Settings Card */}
                <section className="glass-card rounded-2xl p-container-padding flex flex-col gap-3 mt-4 mb-8 transition-all duration-500 opacity-100 translate-y-0">
                    <h3 className="font-label-caps text-label-caps text-outline uppercase mb-1">Data Management</h3>
                    <button 
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-primary/30 text-primary font-label-caps text-label-caps hover:bg-primary/5 transition-colors cursor-pointer active:scale-95 transition-transform font-bold"
                        onClick={exportData}
                    >
                        <span className="material-symbols-outlined text-lg">download</span>
                        Export Data (JSON)
                    </button>
                    <button 
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-error/30 text-error font-label-caps text-label-caps hover:bg-error/5 transition-colors cursor-pointer active:scale-95 transition-transform font-bold"
                        onClick={handleResetRequest}
                    >
                        <span className="material-symbols-outlined text-lg">delete_forever</span>
                        Reset All Data
                    </button>
                </section>
            </div>
        );
    };

    const renderPetrolEntry = () => {
        const estTotal = (parseFloat(litres) || 0) * (parseFloat(pricePerLitre) || 0);
        const hasLowDistance = totalKmSinceLastFill > 0 && totalKmSinceLastFill < 100;
        const litrePercent = Math.min(((parseFloat(litres) || 0) / 60) * 100, 100);
        const litreGaugeDashoffset = 100 - litrePercent;

        const activeMileageForRange = getEffectiveMileage(petrolEntries).mileage || 45;
        const lastLitresForRange = petrolEntries.length > 0 ? petrolEntries[0].litres : 10;
        const estimatedRange = lastLitresForRange * activeMileageForRange;
        const kmRemaining = Math.max(0, estimatedRange - totalKmSinceLastFill);
        const isRangeCritical = kmRemaining < 50 && kmRemaining >= 0;

        return (
            <div className="w-full">
                {/* Background Decoration */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
                    <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]"></div>
                    <div className="absolute top-[40%] -right-[10%] w-[30%] h-[30%] bg-secondary/5 rounded-full blur-[100px]"></div>
                </div>

                {/* TopAppBar */}
                <header className="w-full top-0 pt-6 flex justify-between items-center z-50 max-w-lg mx-auto px-container-padding">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10">
                            <img 
                                className="w-full h-full object-cover" 
                                alt="Driver profile" 
                                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBLOQKXHtXXExrSkQRimHNBihV-jjRsTc47yKNxbtoPRCF6E4Zk1HkYcWUyJMIlaAon9MUVDIl0KBViE2uMUQ4XRbtJzvGQhSCVYqv-1MdWKxtrTJGEF6Ib42qwD4C37FX0-tA50HK5Q5uLhdSblTwNeCY5zlOPFRq9nPSr7NGAJFTPDnTfuDpCrj9OARH-_xgo6VM_tSCMQKUKt24X6eOvWtpvXU7PGFlg3T_kfPie631vWJ9PX2YHmg" 
                            />
                        </div>
                        <h1 className="font-headline-lg text-headline-lg font-extrabold text-primary tracking-tight" onClick={() => setActiveScreen('dashboard')} style={{ cursor: 'pointer' }}>Fuel &amp; Ride</h1>
                    </div>
                    <button 
                        className="text-primary hover:opacity-80 transition-opacity duration-300 active:scale-95 transition-transform"
                        onClick={() => alert("No new notifications")}
                    >
                        <span className="material-symbols-outlined text-[28px]">notifications</span>
                    </button>
                </header>

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

                    {/* Range / Low Distance Alert */}
                    {(isRangeCritical || hasLowDistance) && (
                        <div className="glass-card rounded-xl flex items-center p-4 border-l-4 border-l-secondary animate-zoom-in-fade" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                            <div className="w-2 h-2 rounded-full bg-secondary mr-3 flex-shrink-0 animate-pulse-record"></div>
                            <span className="material-symbols-outlined text-secondary mr-3 flex-shrink-0">route</span>
                            <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-on-surface">Range Critical</span>
                                <span className="text-[11px] text-on-surface-variant">
                                    {isRangeCritical
                                        ? `Estimated ${kmRemaining.toFixed(0)} km remaining. Find nearest station.`
                                        : `Low distance since last fill: ${totalKmSinceLastFill.toFixed(1)} km`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Trip Since Last Refuel Info */}
                    <div className={`glass-card rounded-2xl p-4 border-l-4 ${hasLowDistance ? 'border-l-tertiary' : 'border-l-primary'} flex items-center gap-4 animate-pulse-subtle`}>
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="material-symbols-outlined text-primary text-[18px]">distance</span>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-0.5">
                                {hasLowDistance ? "Low Distance Since Last Refuel" : "Trip Since Last Refuel"}
                            </p>
                            <p className="text-[14px] font-semibold text-on-surface">
                                Distance: <span className="text-primary font-extrabold">{totalKmSinceLastFill.toFixed(1)} km</span>
                            </p>
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
                        {/* Top App Bar */}
                        <header className="flex justify-between items-center px-container-padding py-4 w-full bg-transparent max-w-md mx-auto">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-primary text-headline-md">motorcycle</span>
                                <h1 className="font-display-hero text-headline-md tracking-tighter text-primary font-extrabold uppercase">PERSONAL TRIP</h1>
                            </div>
                            <div className="w-10 h-10 rounded-full border border-outline/20 overflow-hidden">
                                <img 
                                    className="w-full h-full object-cover" 
                                    alt="Driver profile" 
                                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuBLOQKXHtXXExrSkQRimHNBihV-jjRsTc47yKNxbtoPRCF6E4Zk1HkYcWUyJMIlaAon9MUVDIl0KBViE2uMUQ4XRbtJzvGQhSCVYqv-1MdWKxtrTJGEF6Ib42qwD4C37FX0-tA50HK5Q5uLhdSblTwNeCY5zlOPFRq9nPSr7NGAJFTPDnTfuDpCrj9OARH-_xgo6VM_tSCMQKUKt24X6eOvWtpvXU7PGFlg3T_kfPie631vWJ9PX2YHmg" 
                                />
                            </div>
                        </header>

                        <main className="px-container-padding space-y-element-gap mt-4 max-w-md mx-auto">
                            {/* Trip Type Badge */}
                            <div className="w-full py-3 bg-gradient-to-r from-primary-container to-primary rounded-full flex items-center justify-center animate-pulse-record shadow-[0_0_20px_rgba(78,204,163,0.3)]">
                                <span className="font-label-caps text-label-caps text-on-primary-container uppercase font-bold">ðŸï¸ PERSONAL TRIP IN PROGRESS ({tripTimeText})</span>
                            </div>
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
                                            <span className="font-label-caps text-[10px] text-on-surface font-bold">Tracking Personal (High Accuracy)</span>
                                        </div>
                                    </div>
                                    <div className="font-mono text-[11px] text-on-surface-variant flex gap-4">
                                        <span>Updates: {gpsDebug.updates}</span>
                                        <span>Accuracy: {gpsDebug.accuracy ? gpsDebug.accuracy.toFixed(0) : '8'}m</span>
                                        <span className="ml-auto">LAT: {gpsDebug.lastLat ? gpsDebug.lastLat.toFixed(4) : '0.0000'}Â° N</span>
                                    </div>
                                </div>
                            </div>

                            {/* Trip Status Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="glass-card p-4 rounded-2xl active-glow">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">CURRENT TRIP</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className="font-stats-numeral text-headline-md text-primary font-bold">{distanceVal.toFixed(2)}</span>
                                            <span className="font-label-caps text-[10px] text-primary font-bold">KM</span>
                                        </div>
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
                ) : (
                    /* layout before personal trip starts (START PERSONAL TRIP) */
                    <div className="w-full">
                        {/* TopAppBar */}
                        <header className="fixed top-0 left-0 right-0 w-full z-50 flex items-center justify-between px-container-padding h-16 bg-surface/80 backdrop-blur-xl border-b border-white/10 shadow-sm max-w-md mx-auto">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full overflow-hidden border border-primary/30">
                                    <img 
                                        className="w-full h-full object-cover" 
                                        alt="Driver profile" 
                                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuBLOQKXHtXXExrSkQRimHNBihV-jjRsTc47yKNxbtoPRCF6E4Zk1HkYcWUyJMIlaAon9MUVDIl0KBViE2uMUQ4XRbtJzvGQhSCVYqv-1MdWKxtrTJGEF6Ib42qwD4C37FX0-tA50HK5Q5uLhdSblTwNeCY5zlOPFRq9nPSr7NGAJFTPDnTfuDpCrj9OARH-_xgo6VM_tSCMQKUKt24X6eOvWtpvXU7PGFlg3T_kfPie631vWJ9PX2YHmg" 
                                    />
                                </div>
                                <span className="font-display-hero text-headline-md text-primary tracking-tight font-extrabold" onClick={() => setActiveScreen('dashboard')} style={{ cursor: 'pointer' }}>Personal Trip</span>
                            </div>
                            <button 
                                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors active:scale-95 duration-200 text-primary"
                                onClick={() => alert(isTracking ? "A trip is currently active on another screen!" : "No new notifications")}
                            >
                                <span className="material-symbols-outlined">notifications</span>
                            </button>
                        </header>

                        {/* Main Content Canvas */}
                        <main className="w-full max-w-md px-container-padding mt-24 flex flex-col gap-element-gap mx-auto">
                            {/* Header Section */}
                            <section className="flex flex-col gap-1">
                                <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold">Private Mode</h1>
                                <p className="font-body-md text-on-surface-variant">Your business data is hidden.</p>
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
                            </section>

                            {/* Info Tip */}
                            <div className="flex items-start gap-3 p-4 bg-surface-container-low/50 rounded-xl border border-white/5 mt-4">
                                <span className="material-symbols-outlined text-primary/60 text-sm">info</span>
                                <p className="font-body-md text-body-md text-on-surface-variant/80 italic text-sm">
                                    In private mode, trip details are not synced to your business dashboard.
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
        const recentRides = rideEntries.slice(0, 5);
        const distanceVal = currentTrip ? currentTrip.distance : 0;

        // Today's Goal logic
        const todayStr = new Date().toDateString();
        const todayEarnings = rideEntries
            .filter(ride => new Date(ride.date).toDateString() === todayStr)
            .reduce((sum, ride) => sum + (ride.totalEarnings || 0), 0);
        const dailyGoal = 2000;
        const goalPct = Math.min(100, Math.round((todayEarnings / dailyGoal) * 100));



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
                        {/* Top App Bar */}
                        <header className="w-full top-0 flex justify-between items-center px-container-padding py-4 w-full bg-transparent max-w-md mx-auto">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full overflow-hidden border border-primary/30">
                                    <img 
                                        className="w-full h-full object-cover" 
                                        alt="Driver profile" 
                                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuCNrUwA_nlcrnRZv4b475RxLSIDJ3rrhDgl9QAb_hnoCsLPiGbgD-hV6Yh2BJNRElEdBhYHW08i3rA9lIk-f8-6lyUzXUAbTrherxCVBepHvtV-b1qXvbUrLnarSedxPwBwIh3GzITQhAnjC9Ko_J_vibLtvJ0TFsd4fLQxo0l-Xo85xXaP5yogoe7tpPC4lWOvZx5oVrXNf6Gh7ZBzYidAoOTHfrVZVGJBbozVb03uzE3l64udfbqOKA" 
                                    />
                                </div>
                                <h1 className="font-headline-md text-[24px] text-on-surface flex items-center gap-2 font-bold">
                                    <span className="material-symbols-outlined text-secondary">card_travel</span>
                                    Ride Trip
                                </h1>
                            </div>
                            <button className="hover:opacity-80 transition-opacity active:scale-95 text-on-surface">
                                <span className="material-symbols-outlined text-[28px]">notifications</span>
                            </button>
                        </header>

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
                                    <span className="font-label-caps text-white tracking-widest font-bold">ðŸš– RIDE TRIP IN PROGRESS</span>
                                </div>
                            </section>

                            {/* GPS & Trip Stats Grid */}
                            <section className="grid grid-cols-2 gap-element-gap">
                                <div className="col-span-2 glass-card rounded-xl p-4 flex items-center gap-3 border-l-4 border-secondary">
                                    <span className="material-symbols-outlined text-secondary animate-pulse">gps_fixed</span>
                                    <div>
                                        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase font-bold">Navigation System</p>
                                        <p className="font-body-md text-on-surface">Tracking Ride (High Accuracy)</p>
                                    </div>
                                </div>
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
                        {/* Top Navigation Bar */}
                        <header className="w-full flex items-center justify-between px-container-padding h-16 bg-surface/80 dark:bg-surface/80 backdrop-blur-xl border-b border-white/10 shadow-sm max-w-md mx-auto">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full overflow-hidden border border-secondary/30">
                                    <img 
                                        className="w-full h-full object-cover" 
                                        alt="Driver profile"
                                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuBp5R0k8vmXlCArRYkpvTyqmvqR-vAdgLgLEJnvjO0expPrL9QC6LuGxeOypbWvc5B5RhidjzbJxUDI-8XZoP-YHAD57O3mDWZthHKknURU6Jtiwc4G-z8G44TFyfh-_ddi33wN4ksq7elWHBiT186ke0JGBy4ZYjdWJJ_TUDMB1gs2lEqXtlShnbzLD3uYlTw8zjbdYqcPZhtArr52S0k-CNhRYK35a3QGxCteWDzfRLgtzIg95Wlc3A" 
                                    />
                                </div>
                                <span className="font-headline-md text-headline-md text-primary tracking-tight font-bold">Start Ride</span>
                            </div>
                            <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors scale-95 active:duration-150 text-on-surface-variant">
                                <span className="material-symbols-outlined">notifications</span>
                            </button>
                        </header>

                        <main className="px-container-padding flex flex-col max-w-md mx-auto mt-6">
                            {/* Welcome Header */}
                            <div className="mb-6">
                                <h1 className="font-display-hero text-headline-lg text-on-surface leading-tight font-extrabold">Ready to Earn?</h1>
                                <p className="font-body-lg text-body-md text-on-surface-variant mt-2">Systems check complete. Your next ride is a tap away.</p>
                            </div>

                            {/* Pre-Flight Summary Bento */}
                            <div className="grid grid-cols-2 gap-element-gap mb-6">
                                {/* Earnings Goal Card */}
                                <div className="col-span-2 glass-card rounded-xl p-5 flex flex-col gap-4">
                                    <div className="flex justify-between items-center">
                                        <span className="font-label-caps text-label-caps text-on-surface-variant font-bold uppercase">TODAY'S GOAL</span>
                                        <span className="font-stats-numeral text-stats-numeral text-secondary font-bold">PKR {todayEarnings} / PKR {dailyGoal}</span>
                                    </div>
                                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full ride-gradient rounded-full shadow-[0_0_8px_#b9c3ff]" style={{ width: `${goalPct}%` }}></div>
                                    </div>
                                    <p className="font-body-md text-body-sm text-on-surface-variant/80 text-sm">
                                        {goalPct}% reached. {goalPct >= 100 ? 'Goal achieved! Keep rolling.' : 'Keep driving to hit today\'s milestone.'}
                                    </p>
                                </div>
                            </div>

                            {/* Action Center */}
                            <div className="space-y-4">
                                <button 
                                    className="w-full h-16 ride-gradient text-on-primary font-headline-md text-headline-md rounded-xl flex items-center justify-center gap-3 shadow-[0_8px_32px_rgba(31,59,166,0.4)] transition-all hover:scale-[1.02] active:scale-95 group overflow-hidden relative font-bold cursor-pointer"
                                    onClick={() => startGPSTracking(true)}
                                >
                                    <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <span className="material-symbols-outlined text-2xl">play_circle</span>
                                    START RIDE
                                </button>
                                <button 
                                    className="w-full h-14 bg-transparent border border-white/10 text-on-surface font-body-lg text-body-lg rounded-xl flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-95 cursor-pointer"
                                    onClick={() => setShowRideEntry(true)}
                                >
                                    <span className="material-symbols-outlined text-xl">add_circle</span>
                                    Add Manual Ride
                                </button>
                            </div>

                            {/* Visual Map Detail */}
                            <div className="mt-8 relative h-32 w-full glass-card rounded-xl overflow-hidden grayscale opacity-40">
                                <div className="absolute inset-0 w-full h-full" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCy6LXnQMzJPeeNBOH9qUELd-6Q1dhqCVofQXjZDfaGUteEQMlEf3eJtGVqFbnBCv5XbIBws1VSUwbxhWDWC5WDDzHifYiqEOi8sy2Q47171m7AZwYkPpfEoqS2DtJwHSwUCpIJJlOjC7DFZB872Zc0JMURUB3-7k8Jvlcv-80Ia6MCA0TzKly1uDwDTCQF2svggWGdBZxBae2b_CmH-MCl9lyMTMk-ibOK--7rDomX99mMHCC8lD5zrw')" }}></div>
                                <div className="absolute inset-0 bg-gradient-to-t from-surface-dim to-transparent"></div>
                            </div>
                        </main>
                    </div>
                )}

                {/* August/Monthly Earnings Card */}
                {!isRideActive && (
                    <main className="px-container-padding max-w-md mx-auto mt-6">
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
                                    <p className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold">Tips ðŸŽ</p>
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

                        {/* Recent Rides List */}
                        <section className="space-y-4 pt-6 pb-20">
                            <h3 className="font-headline-md text-white px-2 font-bold">Recent Rides</h3>
                            <div className="space-y-sm">
                                {recentRides.length === 0 ? (
                                    <div className="glass-card p-lg text-center text-on-surface-variant rounded-xl">
                                        No rides logged this month yet.
                                    </div>
                                ) : (
                                    recentRides.map(ride => (
                                        <div key={ride.id} className="glass-card rounded-xl overflow-hidden border-l-4 border-secondary flex flex-col hover:bg-surface-container-high transition-colors">
                                            <div className="p-4 flex justify-between items-start">
                                                <div>
                                                    <p className="font-label-caps text-on-surface-variant text-[11px] font-bold">
                                                        {new Date(ride.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}, {new Date(ride.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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
                                                    <p className="text-[13px] font-semibold text-white">{ride.km.toFixed(1)}km</p>
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
                                                <span className="text-on-surface-variant font-medium">Cost: <span class="text-error">PKR {ride.costPerKm.toFixed(1)}/km</span></span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </main>
                )}
            </div>
        );
    };
    const renderCalculator = () => {
        const effectiveMileageData = getEffectiveMileage(petrolEntries);


        return (
            <div className="w-full animate-zoom-in-fade">
                {/* Top App Bar */}
                <header className="flex justify-between items-center w-full sticky top-0 z-50 bg-surface/10 backdrop-blur-md px-container-padding py-4 max-w-md mx-auto">
                    <div className="flex flex-col">
                        <h1 className="font-display-hero text-headline-md text-primary dark:text-primary tracking-tight font-extrabold" onClick={() => setActiveScreen('dashboard')} style={{ cursor: 'pointer' }}>Fare Calculator</h1>
                        <p className="font-label-caps text-[10px] text-on-surface-variant/70 uppercase tracking-widest -mt-1 font-bold">Compare offers Ã‚Â· negotiate better rates</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-primary/40">
                            <img className="w-full h-full object-cover" alt="Driver profile" src="https://lh3.googleusercontent.com/aida-public/AB6AXuADqWXwzNBqr3QaDioTFJ7Y2mi-UFl6-7-z1cxqki1Io_bF1ymZJI8I8heuUCq7IWynvJC23JrEyTl8tEnsHbEQfUdTrTJ2Z92weowkgQ8jw-sYhiQzfb2Lhwn0DvMuK--2ua5p2Jcm2h2sfKkOVR1XmPoUdia5KorWNey6RLFc0qJw92mUtWgBnwkPFf-YMEdoH2TbRcO5X-iQFZ6CqkuLOwxggk31CVGrjfSJVPxuenQhWaTDNKvTLA" />
                        </div>
                    </div>
                </header>

                <main className="px-container-padding mt-4 space-y-6 max-w-md mx-auto pb-32">

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
                {/* Top App Bar */}
                <header className="w-full top-0 sticky z-50 bg-background/80 backdrop-blur-xl">
                    <div className="flex items-center justify-between px-container-padding py-4 w-full max-w-2xl mx-auto">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border border-white/10 cursor-pointer" onClick={() => setActiveScreen('dashboard')}>
                                <img 
                                    className="w-full h-full object-cover" 
                                    alt="Driver profile" 
                                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuDMrCAwXi9vMdHWDwYCFAgA84tSygJjvvh5qwuIF-gwkLNow4-RSTTedAueM3DuVNPGxapivMvnZp-R6l5p8JkxdfrAsrCY7B0Tomxia-pah6QJy0pvdC79XNTSeNu7LTYeUkV-5iQL_0IhiAAvKipuE0UC2naxA5vTmnGGvQ1ANHkboQEGXCEkGLBDqi9XFGO5UZr82bqrrTXyHWCu9oTyZxXy8xPzPC-VUH5UHfrnbYAbYlHEZux-QA" 
                                />
                            </div>
                            <h1 className="font-display-hero text-headline-lg text-primary tracking-tighter font-extrabold">Fuel History</h1>
                        </div>
                        <button className="text-primary hover:opacity-80 transition-all duration-300 ease-in-out">
                            <span className="material-symbols-outlined">notifications</span>
                        </button>
                    </div>
                </header>

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
            {activeScreen !== 'fuel' && activeScreen !== 'dashboard' && activeScreen !== 'personal' && activeScreen !== 'ride' && activeScreen !== 'history' && (
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
                                    âœï¸ Add Manual KM
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
                                    <h1 className="font-headline-md text-headline-md text-on-surface">ðŸš– Add Ride Manually</h1>
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
                                        Tip (Optional ðŸŽ)
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
                                    <span>âœ… Save Ride & Profit</span>
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
