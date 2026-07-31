import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

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

    // Ride profit calculator states
    const [showRideEntry, setShowRideEntry] = useState(false);
    const [rideKm, setRideKm] = useState('');
    const [rideEarnings, setRideEarnings] = useState('');
    const [rideTip, setRideTip] = useState(''); // NEW: Tip amount
    const [rideEntries, setRideEntries] = useState([]);

    // Trip type selection
    const [showTripTypeDialog, setShowTripTypeDialog] = useState(false);

    // NEW: Ride completion dialog
    const [showRideCompletionDialog, setShowRideCompletionDialog] = useState(false);
    const [completedRideKm, setCompletedRideKm] = useState(0);

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

    useEffect(() => {
        if (!isTracking) {
            setSmoothSpeed(0);
            return;
        }

        let animationFrameId;
        const targetSpeed = gpsDebug.speed * 3.6;

        const animate = () => {
            setSmoothSpeed(prev => {
                const diff = targetSpeed - prev;
                if (Math.abs(diff) < 0.05) {
                    return targetSpeed;
                }
                const step = diff * 0.06;
                return prev + step;
            });
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [gpsDebug.speed, isTracking]);

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);
    const positionCountRef = useRef(0);
    const positionHistoryRef = useRef([]);
    const isFirstPositionAfterStart = useRef(true);

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
                message = 'Please allow GPS permission';
                status = 'Permission Denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'GPS unavailable. Go outdoors!';
                status = 'Signal Unavailable';
                break;
            case error.TIMEOUT:
                message = 'GPS timeout. Retrying...';
                status = 'Searching for signal...';
                setGpsDebug(prev => ({ ...prev, status }));
                return;
            default:
                message = 'GPS error: ' + error.message;
                status = 'Error';
        }

        setGpsDebug(prev => ({ ...prev, status }));
        showGpsMessage(message, true);
    }, [showGpsMessage]);

    const handlePositionUpdate = useCallback((position) => {
        positionCountRef.current += 1;
        const updateNum = positionCountRef.current;

        console.log(`\n========== GPS Update #${updateNum} ==========`);
        console.log('Time:', new Date().toLocaleTimeString());
        console.log('Lat:', position.coords.latitude.toFixed(8));
        console.log('Lng:', position.coords.longitude.toFixed(8));
        console.log('Accuracy:', position.coords.accuracy.toFixed(1), 'm');
        console.log('Speed:', position.coords.speed, 'm/s');

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
            console.log('ℹ️ First position after start - reference point');
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            isFirstPositionAfterStart.current = false;
            console.log('==========================================\n');
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
            console.log('Distance from last:', distanceMeters.toFixed(2), 'm');

            let shouldUpdate = false;
            let reason = '';

            if (distanceMeters < 10) {
                reason = 'Distance < 10m (GPS drift)';
                console.log('⏭️', reason);
                shouldUpdate = false;
            }
            else if (position.coords.accuracy > 30) {
                reason = 'Accuracy poor (' + position.coords.accuracy.toFixed(0) + 'm)';
                console.log('⏭️', reason);
                shouldUpdate = false;
            }
            else if (position.coords.speed !== null && position.coords.speed < 0.5) {
                if (distanceMeters < 15) {
                    reason = 'Low speed and small distance';
                    console.log('⏭️', reason);
                    shouldUpdate = false;
                } else {
                    shouldUpdate = true;
                    reason = 'Distance significant despite low speed';
                }
            }
            else if (positionHistoryRef.current.length >= 3) {
                let totalDistance = 0;
                for (let i = 1; i < positionHistoryRef.current.length; i++) {
                    const prev = positionHistoryRef.current[i - 1];
                    const curr = positionHistoryRef.current[i];
                    totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) * 1000;
                }

                console.log('Total over', positionHistoryRef.current.length, 'points:', totalDistance.toFixed(2), 'm');

                if (totalDistance > 20) {
                    shouldUpdate = true;
                    reason = 'Consistent movement';
                } else if (distanceMeters > 20) {
                    shouldUpdate = true;
                    reason = 'Large single movement';
                } else {
                    reason = 'Total movement too small (drift)';
                    console.log('⏭️', reason);
                    shouldUpdate = false;
                }
            }
            else if (distanceMeters > 20) {
                shouldUpdate = true;
                reason = 'Large movement detected';
            }
            else {
                shouldUpdate = true;
                reason = 'Normal movement';
            }

            if (shouldUpdate) {
                console.log('✅ UPDATING -', reason);
                console.log('Adding:', distanceMeters.toFixed(2), 'm');

                setCurrentTrip(prev => {
                    if (!prev) return prev;
                    const newDistance = prev.distance + distance;
                    console.log('Trip:', prev.distance.toFixed(6), '→', newDistance.toFixed(6), 'km');
                    return { ...prev, distance: newDistance };
                });

                setTotalKmSinceLastFill(prev => {
                    const newTotal = prev + distance;
                    console.log('Total:', prev.toFixed(6), '→', newTotal.toFixed(6), 'km');
                    return newTotal;
                });

                setGpsDebug(prev => ({ ...prev, lastDistance: distanceMeters }));
                lastPositionRef.current = newPosition;
                positionHistoryRef.current = [newPosition];
            } else {
                console.log('⏭️ Skipped -', reason);
                setGpsDebug(prev => ({ ...prev, lastDistance: 0 }));
            }
        } else {
            console.log('ℹ️ Setting initial reference point');
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
        }

        console.log('==========================================\n');
    }, [calculateDistance]);

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

            if (dataString.length > 5000000) {
                console.warn('Data size approaching limit');
                const trimmedData = {
                    ...data,
                    petrolEntries: data.petrolEntries.slice(0, 50),
                    trips: data.trips.slice(0, 100),
                    rideEntries: data.rideEntries.slice(0, 100)
                };
                localStorage.setItem('petrolTrackerData', JSON.stringify(trimmedData));
            } else {
                localStorage.setItem('petrolTrackerData', dataString);
            }
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('Storage quota exceeded');
                alert('⚠️ Storage full! Some old data may be removed.');
                const emergencyData = {
                    petrolEntries: petrolEntries.slice(0, 20),
                    trips: trips.slice(0, 50),
                    currentTrip,
                    totalKmSinceLastFill,
                    rideEntries: rideEntries.slice(0, 50),
                    lastSaved: new Date().toISOString()
                };
                try {
                    localStorage.setItem('petrolTrackerData', JSON.stringify(emergencyData));
                } catch (e) {
                    console.error('Emergency save failed:', e);
                }
            } else {
                console.error('Storage error:', error);
            }
        }
    }, [petrolEntries, trips, currentTrip, totalKmSinceLastFill, rideEntries]);

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

        const entry = {
            id: Date.now(),
            litres: roundedLitres,
            pricePerLitre: roundedPrice,
            totalCost: roundedLitres * roundedPrice,
            date: fillDate,
            kmTraveled: totalKmSinceLastFill,
            mileage: totalKmSinceLastFill > 0 ? (totalKmSinceLastFill / roundedLitres).toFixed(2) : 0
        };

        setPetrolEntries(prev => [entry, ...prev]);
        setTotalKmSinceLastFill(0);
        setTrips([]);
        setLitres('');
        setPricePerLitre('');
        const today = new Date().toISOString().split('T')[0];
        setFillDate(today);

        alert('✅ Petrol entry saved!');
        setActiveScreen('dashboard');
    };

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

    const handleRideEntryRequest = () => {
        setShowRideEntry(true);
    };

    const saveRideEntry = () => {
        const kmNum = parseFloat(rideKm);
        const earningsNum = parseFloat(rideEarnings);
        const tipNum = parseFloat(rideTip) || 0; // NEW: Parse tip

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
        const roundedTip = Math.round(tipNum * 100) / 100; // NEW

        const lastEntry = petrolEntries[0];
        let costPerKm = 0;
        let fuelUsed = 0;
        let fuelCost = 0;

        if (lastEntry) {
            const mileage = lastEntry.mileage > 0 ? parseFloat(lastEntry.mileage) :
                (lastEntry.litres > 0 && totalKmSinceLastFill > 0 ?
                    totalKmSinceLastFill / lastEntry.litres : 0);

            if (mileage > 0) {
                fuelUsed = roundedKm / mileage;
                fuelCost = fuelUsed * lastEntry.pricePerLitre;
                costPerKm = lastEntry.pricePerLitre / mileage;
            }
        }

        const totalEarnings = roundedEarnings + roundedTip; // NEW: Total with tip
        const profit = totalEarnings - fuelCost;
        const profitPerKm = roundedKm > 0 ? profit / roundedKm : 0;

        const rideEntry = {
            id: Date.now(),
            date: new Date().toISOString(),
            km: roundedKm,
            earnings: roundedEarnings,
            tip: roundedTip, // NEW
            totalEarnings: totalEarnings, // NEW
            fuelUsed: fuelUsed,
            fuelCost: fuelCost,
            profit: profit,
            profitPerKm: profitPerKm,
            costPerKm: costPerKm
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
        setRideTip(''); // NEW: Clear tip
        setShowRideEntry(false);

        alert(`✅ Ride Saved!\n\n` +
            `Distance: ${roundedKm} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip}\n` : '') +
            `Total Earnings: Rs. ${totalEarnings}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💰 Profit: Rs. ${profit.toFixed(2)}\n` +
            `Per KM: Rs. ${profitPerKm.toFixed(2)}/km`
        );
    };

    const cancelRideEntry = () => {
        setRideKm('');
        setRideEarnings('');
        setRideTip(''); // NEW
        setShowRideEntry(false);
    };

    // NEW: Handle trip type selection dialog
    const handleStartTripRequest = () => {
        setShowTripTypeDialog(true);
    };

    const startTripWithType = (isRideTrip) => {
        setShowTripTypeDialog(false);

        // Start GPS tracking immediately for both types
        startGPSTracking(isRideTrip);
    };

    const cancelTripTypeSelection = () => {
        setShowTripTypeDialog(false);
    };

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
                    console.log('High accuracy timeout, trying standard mode...');
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

    // NEW: Stop trip and show completion dialog for rides
    const stopTrip = () => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        if (currentTrip) {
            const actualKm = currentTrip.distance;

            // If it was a ride trip, show completion dialog
            if (currentTrip.isRide) {
                setCompletedRideKm(actualKm);
                setShowRideCompletionDialog(true);
                setIsTracking(false);
                setGpsDebug(prev => ({ ...prev, status: 'Stopped', speed: 0 }));
            } else {
                // Personal trip - just save and close
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
    };

    // NEW: Complete ride with earnings
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

        const lastEntry = petrolEntries[0];
        let costPerKm = 0;
        let fuelUsed = 0;
        let fuelCost = 0;

        if (lastEntry) {
            const mileage = lastEntry.mileage > 0 ? parseFloat(lastEntry.mileage) :
                (lastEntry.litres > 0 && totalKmSinceLastFill > 0 ?
                    totalKmSinceLastFill / lastEntry.litres : 0);

            if (mileage > 0) {
                fuelUsed = actualKm / mileage;
                fuelCost = fuelUsed * lastEntry.pricePerLitre;
                costPerKm = lastEntry.pricePerLitre / mileage;
            }
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
            costPerKm: costPerKm
        };

        setRideEntries(prev => [rideEntry, ...prev]);

        // Save trip
        const completedTrip = {
            ...currentTrip,
            endTime: new Date().toISOString(),
            isActive: false,
            earnings: totalEarnings
        };

        setTrips(prev => [...prev, completedTrip]);
        setCurrentTrip(null);

        // Clear states
        setRideEarnings('');
        setRideTip('');
        setShowRideCompletionDialog(false);
        setCompletedRideKm(0);

        // Show summary
        alert(`✅ Ride Completed!\n\n` +
            `Distance: ${actualKm.toFixed(2)} km\n` +
            `Base Fare: Rs. ${roundedEarnings}\n` +
            (roundedTip > 0 ? `Tip: Rs. ${roundedTip} 🎁\n` : '') +
            `Total Earnings: Rs. ${totalEarnings}\n` +
            `Fuel Used: ${fuelUsed.toFixed(2)} L\n` +
            `Fuel Cost: Rs. ${fuelCost.toFixed(2)}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💰 Net Profit: Rs. ${profit.toFixed(2)}\n` +
            `Per KM: Rs. ${profitPerKm.toFixed(2)}/km`
        );
    };

    const cancelRideCompletion = () => {
        // If user cancels, still save the trip but without earnings data
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

    const getMonthlySummary = () => {
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
    };

    const getRideSummary = () => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalRides = 0;
        let totalRideKm = 0;
        let totalEarnings = 0;
        let totalTips = 0; // NEW
        let totalFuelCost = 0;
        let totalProfit = 0;

        rideEntries.forEach(ride => {
            const rideDate = new Date(ride.date);
            if (rideDate.getMonth() === currentMonth &&
                rideDate.getFullYear() === currentYear) {
                totalRides++;
                totalRideKm += ride.km;
                totalEarnings += ride.totalEarnings; // Already includes tip
                totalTips += ride.tip || 0; // NEW
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
            totalTips, // NEW
            totalFuelCost,
            totalProfit,
            avgProfitPerRide,
            avgProfitPerKm
        };
    };

    const SpeedometerComponent = useMemo(() => {
        return ({ speed }) => {
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
                            <circle
                                key={r}
                                cx="150"
                                cy="150"
                                r={r}
                                fill="none"
                                stroke="rgba(66, 230, 207, 0.07)"
                                strokeWidth="1.5"
                            />
                        ))}

                        <path
                            d="M 72.22 227.78 A 110 110 0 1 1 227.78 227.78"
                            fill="none"
                            stroke="url(#speedGradient)"
                            strokeWidth="14"
                            strokeLinecap="round"
                        />

                        {[
                            { speed: 0, x: 55, y: 245, label: '0' },
                            { speed: 30, x: 30, y: 100, label: '30' },
                            { speed: 60, x: 150, y: 15, label: '60' },
                            { speed: 90, x: 270, y: 100, label: '90' },
                            { speed: 120, x: 245, y: 245, label: '120' }
                        ].map(({ speed, x, y, label }) => (
                            <text
                                key={speed}
                                x={x}
                                y={y}
                                fill="#b5c0c9"
                                fontSize="24"
                                fontWeight="400"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                style={{ fontFamily: "'Caveat', 'Kalam', cursive" }}
                            >
                                {label}
                            </text>
                        ))}

                        <g transform={`rotate(${rotation} 150 150)`}>
                            <line
                                x1="150"
                                y1="170"
                                x2="150"
                                y2="65"
                                stroke="#42e6cf"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                            />
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
        };
    }, []);

    const Speedometer = React.memo(SpeedometerComponent, (prevProps, nextProps) => {
        return Math.abs(prevProps.speed - nextProps.speed) < 0.5;
    });

    const renderDashboard = () => {
        const monthly = getMonthlySummary();
        const rideSummary = getRideSummary();
        const lastEntry = petrolEntries[0];
        const currentMileage = lastEntry && totalKmSinceLastFill > 0
            ? (totalKmSinceLastFill / lastEntry.litres).toFixed(2)
            : 'N/A';

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
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: '10px' }}
                            onClick={() => setShowInstallPrompt(false)}
                        >
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
                                <div className="stat-label">Mileage</div>
                                <div className="stat-value large">{currentMileage}<span className="stat-unit">km/L</span></div>
                            </div>
                        </div>
                    )}
                </div>

                {rideEntries.length > 0 && (
                    <div className="card">
                        <h2>🚖 Ride Earnings (This Month)</h2>
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
                            <div className="stat-box full-width" style={{ background: 'linear-gradient(135deg, #1a4d6d 0%, #2a5f7f 100%)' }}>
                                <div className="stat-label">💰 NET PROFIT</div>
                                <div className="stat-value large" style={{ color: rideSummary.totalProfit > 0 ? '#4ecca3' : '#ee6c4d' }}>
                                    Rs. {rideSummary.totalProfit.toFixed(2)}
                                </div>
                                <div style={{ color: '#93dac4', fontSize: '12px', marginTop: '5px' }}>
                                    Rs. {rideSummary.avgProfitPerKm.toFixed(2)}/km
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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
                    <input
                        type="number"
                        id="litres"
                        placeholder="Enter litres"
                        step="0.01"
                        min="0"
                        value={litres}
                        onChange={(e) => setLitres(e.target.value)}
                        inputMode="decimal"
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="pricePerLitre">Price per Litre (Rs.)</label>
                    <input
                        type="number"
                        id="pricePerLitre"
                        placeholder="Enter price"
                        step="0.01"
                        min="0"
                        value={pricePerLitre}
                        onChange={(e) => setPricePerLitre(e.target.value)}
                        inputMode="decimal"
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="fillDate">Date</label>
                    <input
                        type="date"
                        id="fillDate"
                        value={fillDate}
                        onChange={(e) => setFillDate(e.target.value)}
                    />
                </div>

                {totalKmSinceLastFill > 0 && (
                    <div className="alert">
                        📍 Distance: <strong>{totalKmSinceLastFill.toFixed(2)} km</strong>
                    </div>
                )}

                <button className="btn btn-success" onClick={savePetrolEntry}>
                    💾 Save Entry
                </button>
            </div>
        );
    };

    const renderGPSTracker = () => {
        const currentTripKm = currentTrip && currentTrip.isActive
            ? currentTrip.distance.toFixed(2)
            : '0.00';

        const lastEntry = petrolEntries[0];
        const monthly = getMonthlySummary();

        let effectiveMileage = 0;
        if (lastEntry && lastEntry.mileage > 0) {
            effectiveMileage = parseFloat(lastEntry.mileage);
        } else if (parseFloat(monthly.avgMileage) > 0) {
            effectiveMileage = parseFloat(monthly.avgMileage);
        } else if (lastEntry && lastEntry.litres > 0 && totalKmSinceLastFill > 0) {
            effectiveMileage = totalKmSinceLastFill / lastEntry.litres;
        }

        let costPerKm = 0;
        if (lastEntry && effectiveMileage > 0) {
            costPerKm = lastEntry.pricePerLitre / effectiveMileage;
        } else if (lastEntry && lastEntry.kmTraveled > 0) {
            costPerKm = lastEntry.totalCost / lastEntry.kmTraveled;
        }

        const tankCostIncurred = costPerKm * totalKmSinceLastFill;
        const currentTripDistanceVal = currentTrip && currentTrip.isActive ? currentTrip.distance : 0;
        const tripCostIncurred = costPerKm * currentTripDistanceVal;
        const totalTankCost = lastEntry ? lastEntry.totalCost : 0;
        const remainingFuelValue = Math.max(0, totalTankCost - tankCostIncurred);

        return (
            <div>
                <div className="card">
                    <h2>📍 GPS Tracker</h2>

                    {isTracking && <Speedometer speed={smoothSpeed} />}

                    {isTracking && currentTrip && (
                        <div style={{
                            background: currentTrip.isRide ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'linear-gradient(135deg, #4ecca3 0%, #3baf84 100%)',
                            padding: '10px 15px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            marginBottom: '15px',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '14px'
                        }}>
                            {currentTrip.isRide ? '🚖 RIDE IN PROGRESS' : '🏍️ PERSONAL TRIP'}
                        </div>
                    )}

                    <div style={{
                        background: isTracking ? 'linear-gradient(135deg, #1a4d6d 0%, #0f3460 100%)' : '#0f3460',
                        padding: '12px',
                        borderRadius: '10px',
                        marginBottom: '15px',
                        border: `2px solid ${isTracking ? '#4ecca3' : '#1a4d6d'}`,
                        fontSize: '12px'
                    }}>
                        <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
                            📡 {gpsDebug.status}
                        </div>
                        {isTracking && (
                            <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5' }}>
                                Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span> |
                                Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                                    {gpsDebug.accuracy.toFixed(0)}m
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="trip-status-grid">
                        <div className={`trip-status-compact ${isTracking ? 'tracking' : ''}`}>
                            <div className="trip-label-small">CURRENT TRIP</div>
                            <div className="trip-value-small">{currentTripKm} km</div>
                        </div>

                        <div className="trip-status-compact">
                            <div className="trip-label-small">TOTAL</div>
                            <div className="trip-value-small">{totalKmSinceLastFill.toFixed(2)} km</div>
                        </div>
                    </div>

                    {!isTracking ? (
                        <>
                            <button className="btn btn-success btn-lg" onClick={handleStartTripRequest}>
                                ▶️ START GPS TRACKING
                            </button>
                            <button
                                className="btn btn-secondary btn-lg"
                                style={{ marginTop: '10px' }}
                                onClick={handleManualEntryRequest}
                            >
                                ✏️ ADD MANUAL KM
                            </button>
                            <button
                                className="btn btn-primary btn-lg"
                                style={{ marginTop: '10px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
                                onClick={handleRideEntryRequest}
                            >
                                🚖 ADD RIDE (WITHOUT GPS)
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-danger btn-lg" onClick={stopTrip}>
                            ⏹️ COMPLETE TRIP
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
                                💡 Add a petrol fill entry in the <strong>Fuel</strong> tab to enable live rupee cost tracking!
                            </p>
                        </div>
                    ) : (
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
                    )}
                </div>
            </div>
        );
    };

    const renderRideHistory = () => {
        return (
            <div className="card">
                <h2>🚖 Ride History</h2>
                {rideEntries.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">🚗</div>
                        <p>No ride entries yet</p>
                        <p style={{ color: '#93dac4', fontSize: '13px', marginTop: '10px' }}>
                            Add your first ride in the Track tab!
                        </p>
                    </div>
                ) : (
                    <div>
                        {rideEntries.map(ride => {
                            const date = new Date(ride.date);
                            const formattedDate = date.toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric'
                            });
                            const formattedTime = date.toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });

                            return (
                                <div key={ride.id} className="history-item" style={{
                                    borderLeft: `4px solid ${ride.profit > 0 ? '#4ecca3' : '#ee6c4d'}`
                                }}>
                                    <div className="history-header">
                                        <div className="history-date">{formattedDate} • {formattedTime}</div>
                                        <div className="history-mileage" style={{
                                            color: ride.profit > 0 ? '#4ecca3' : '#ee6c4d',
                                            fontWeight: 'bold'
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
                                        marginTop: '8px',
                                        padding: '8px',
                                        background: 'rgba(66, 230, 207, 0.1)',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        color: '#93dac4'
                                    }}>
                                        💰 Profit/km: Rs. {ride.profitPerKm.toFixed(2)} | Cost/km: Rs. {ride.costPerKm.toFixed(2)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderHistory = () => {
        return (
            <div>
                {renderRideHistory()}

                <div className="card">
                    <h2>📜 Fuel History</h2>
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
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric'
                                });

                                return (
                                    <div key={entry.id} className="history-item">
                                        <div className="history-header">
                                            <div className="history-date">{formattedDate}</div>
                                            <div className="history-mileage">
                                                {entry.mileage > 0 ? entry.mileage : 'N/A'} km/L
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

    return (
        <div className="App">
            {/* Trip Type Selection Dialog */}
            {showTripTypeDialog && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>🚗 Select Trip Type</h2>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '20px' }}>
                            Choose your trip type to start GPS tracking
                        </p>

                        <div className="modal-buttons">
                            <button
                                className="btn btn-primary"
                                style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
                                onClick={() => startTripWithType(true)}
                            >
                                🚖 Ride Trip
                                <div style={{ fontSize: '12px', marginTop: '5px', opacity: 0.9 }}>
                                    Add earnings after completion
                                </div>
                            </button>
                            <button
                                className="btn btn-success"
                                onClick={() => startTripWithType(false)}
                            >
                                🏍️ Personal Trip
                            </button>
                            <button className="btn btn-secondary" onClick={cancelTripTypeSelection}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW: Ride Completion Dialog */}
            {showRideCompletionDialog && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>🚖 Complete Ride</h2>
                        <div style={{
                            background: 'rgba(78, 204, 163, 0.1)',
                            border: '2px solid #4ecca3',
                            borderRadius: '10px',
                            padding: '15px',
                            marginBottom: '20px',
                            textAlign: 'center'
                        }}>
                            <div style={{ color: '#93dac4', fontSize: '13px', marginBottom: '5px' }}>
                                Distance Covered
                            </div>
                            <div style={{ color: '#4ecca3', fontSize: '32px', fontWeight: 'bold' }}>
                                {completedRideKm.toFixed(2)} km
                            </div>
                        </div>

                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>
                            Enter your ride earnings
                        </p>

                        <div className="input-group">
                            <label htmlFor="rideEarnings">Base Fare (Rs.)</label>
                            <input
                                type="number"
                                id="rideEarnings"
                                placeholder="e.g., 300"
                                step="1"
                                min="0"
                                value={rideEarnings}
                                onChange={(e) => setRideEarnings(e.target.value)}
                                inputMode="decimal"
                                autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
                        </div>

                        <div className="input-group">
                            <label htmlFor="rideTip">Tip (Optional) 🎁</label>
                            <input
                                type="number"
                                id="rideTip"
                                placeholder="e.g., 50"
                                step="1"
                                min="0"
                                value={rideTip}
                                onChange={(e) => setRideTip(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
                        </div>

                        {petrolEntries.length === 0 && (
                            <div style={{
                                background: 'rgba(238, 108, 77, 0.1)',
                                border: '1px solid #ee6c4d',
                                borderRadius: '8px',
                                padding: '12px',
                                marginTop: '15px',
                                fontSize: '13px',
                                color: '#f4a261'
                            }}>
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

            {/* Manual Ride Entry (Without GPS) */}
            {showRideEntry && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>🚖 Add Ride Manually</h2>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                            Manual entry (without GPS tracking)
                        </p>

                        <div className="input-group">
                            <label htmlFor="rideKm">Distance (km)</label>
                            <input
                                type="number"
                                id="rideKm"
                                placeholder="e.g., 15"
                                step="0.1"
                                min="0"
                                value={rideKm}
                                onChange={(e) => setRideKm(e.target.value)}
                                inputMode="decimal"
                                autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
                        </div>

                        <div className="input-group">
                            <label htmlFor="rideEarnings">Base Fare (Rs.)</label>
                            <input
                                type="number"
                                id="rideEarnings"
                                placeholder="e.g., 300"
                                step="1"
                                min="0"
                                value={rideEarnings}
                                onChange={(e) => setRideEarnings(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
                        </div>

                        <div className="input-group">
                            <label htmlFor="rideTip">Tip (Optional) 🎁</label>
                            <input
                                type="number"
                                id="rideTip"
                                placeholder="e.g., 50"
                                step="1"
                                min="0"
                                value={rideTip}
                                onChange={(e) => setRideTip(e.target.value)}
                                inputMode="decimal"
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
                        </div>

                        {petrolEntries.length === 0 && (
                            <div style={{
                                background: 'rgba(238, 108, 77, 0.1)',
                                border: '1px solid #ee6c4d',
                                borderRadius: '8px',
                                padding: '12px',
                                marginTop: '15px',
                                fontSize: '13px',
                                color: '#f4a261'
                            }}>
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
                            <input
                                type="number"
                                id="manualKm"
                                placeholder="Enter km"
                                step="0.1"
                                min="0"
                                value={manualKm}
                                onChange={(e) => setManualKm(e.target.value)}
                                inputMode="decimal"
                                autoFocus
                                style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                            />
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
                {activeScreen === 'petrol' && renderPetrolEntry()}
                {activeScreen === 'gps' && renderGPSTracker()}
                {activeScreen === 'history' && renderHistory()}
            </div>

            <div className="bottom-nav">
                <button
                    className={`nav-btn ${activeScreen === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('dashboard')}
                >
                    <div className="nav-icon">🏠</div>
                    <div>Home</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'petrol' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('petrol')}
                >
                    <div className="nav-icon">⛽</div>
                    <div>Fuel</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'gps' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('gps')}
                >
                    <div className="nav-icon">📍</div>
                    <div>Track</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('history')}
                >
                    <div className="nav-icon">📜</div>
                    <div>History</div>
                </button>
            </div>
        </div>
    );
}

export default App;