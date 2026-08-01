import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

// ==========================================
// CONFIGURATION
// ==========================================
const MILEAGE_CONFIG = {
    MIN_DISTANCE_THRESHOLD: 20,
    ROLLING_WINDOW: 5,
    ENABLE_ALL_TIME_AVG: true
};

const GPS_CONFIG = {
    HIGH_ACCURACY_TIMEOUT: 20000,
    LOW_ACCURACY_TIMEOUT: 30000,
    MAX_AGE_HIGH: 5000,
    MAX_AGE_LOW: 10000,
    MIN_DISTANCE_METERS: 10,
    ACCURACY_THRESHOLD: 30,
    POOR_ACCURACY_THRESHOLD: 50
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
const roundTo2 = (num) => Math.round(num * 100) / 100;

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const toRad = (deg) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDate = (dateStr, includeTime = false) => {
    const date = new Date(dateStr);
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    const formatted = date.toLocaleDateString('en-IN', options);
    if (includeTime) {
        const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        return { date: formatted, time };
    }
    return formatted;
};

// ==========================================
// CUSTOM HOOKS
// ==========================================

// Mileage Calculations Hook
const useMileageCalculations = () => {
    const calculateRollingAverage = useCallback((entries, windowSize = MILEAGE_CONFIG.ROLLING_WINDOW) => {
        if (!entries?.length) return 0;
        const recent = entries.slice(0, Math.min(windowSize, entries.length));
        const totalDistance = recent.reduce((sum, e) => sum + (e.kmTraveled || 0), 0);
        const totalLitres = recent.reduce((sum, e) => sum + e.litres, 0);
        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const calculateAllTimeAverage = useCallback((entries) => {
        if (!entries?.length) return 0;
        const totalDistance = entries.reduce((sum, e) => sum + (e.kmTraveled || 0), 0);
        const totalLitres = entries.reduce((sum, e) => sum + e.litres, 0);
        return totalLitres > 0 ? totalDistance / totalLitres : 0;
    }, []);

    const getEffectiveMileage = useCallback((entries) => {
        if (!entries?.length) return { mileage: 0, source: 'none', isEstimated: false };

        const lastEntry = entries[0];
        const rollingAvg = calculateRollingAverage(entries);
        const lastTankDistance = lastEntry.kmTraveled || 0;
        const shouldUseFallback = lastTankDistance < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD;

        if (shouldUseFallback && rollingAvg > 0 && entries.length >= 2) {
            return { mileage: rollingAvg, source: 'rolling-average', isEstimated: true };
        }

        const lastTankMileage = lastEntry.mileage > 0
            ? parseFloat(lastEntry.mileage)
            : (lastEntry.litres > 0 && lastTankDistance > 0
                ? lastTankDistance / lastEntry.litres
                : 0);

        return { mileage: lastTankMileage, source: 'last-tank', isEstimated: false };
    }, [calculateRollingAverage]);

    return { calculateRollingAverage, calculateAllTimeAverage, getEffectiveMileage };
};

// GPS Tracking Hook
const useGPSTracking = (onPositionUpdate, onError) => {
    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const positionHistoryRef = useRef([]);
    const isFirstPositionRef = useRef(true);
    const positionCountRef = useRef(0);

    const [gpsDebug, setGpsDebug] = useState({
        updates: 0,
        lastLat: 0,
        lastLng: 0,
        accuracy: 0,
        speed: 0,
        status: 'Not started',
        lastDistance: 0
    });

    const shouldUpdatePosition = useCallback((newPos, distance) => {
        const distanceMeters = distance * 1000;

        if (distanceMeters < GPS_CONFIG.MIN_DISTANCE_METERS) return false;
        if (newPos.accuracy > GPS_CONFIG.ACCURACY_THRESHOLD) return false;

        if (newPos.speed !== null && newPos.speed < 0.5) {
            return distanceMeters >= 15;
        }

        if (positionHistoryRef.current.length >= 3) {
            let totalDistance = 0;
            for (let i = 1; i < positionHistoryRef.current.length; i++) {
                const prev = positionHistoryRef.current[i - 1];
                const curr = positionHistoryRef.current[i];
                totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) * 1000;
            }
            return totalDistance > 20 || distanceMeters > 20;
        }

        return distanceMeters > 20;
    }, []);

    const handlePosition = useCallback((position) => {
        positionCountRef.current += 1;

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
            updates: positionCountRef.current,
            lastLat: newPosition.lat,
            lastLng: newPosition.lng,
            accuracy: newPosition.accuracy,
            speed: newPosition.speed,
            status: 'Active ✓',
            lastDistance: 0
        });

        if (isFirstPositionRef.current) {
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            isFirstPositionRef.current = false;
            return;
        }

        if (lastPositionRef.current) {
            const distance = calculateDistance(
                lastPositionRef.current.lat,
                lastPositionRef.current.lng,
                newPosition.lat,
                newPosition.lng
            );

            if (shouldUpdatePosition(newPosition, distance)) {
                onPositionUpdate(distance);
                setGpsDebug(prev => ({ ...prev, lastDistance: distance * 1000 }));
                lastPositionRef.current = newPosition;
                positionHistoryRef.current = [newPosition];
            } else {
                setGpsDebug(prev => ({ ...prev, lastDistance: 0 }));
            }
        }
    }, [onPositionUpdate, shouldUpdatePosition]);

    const startTracking = useCallback((highAccuracy = true) => {
        if (watchIdRef.current) return;

        isFirstPositionRef.current = true;
        positionCountRef.current = 0;
        positionHistoryRef.current = [];
        setGpsDebug(prev => ({ ...prev, status: 'Getting GPS lock...' }));

        const options = {
            enableHighAccuracy: highAccuracy,
            timeout: highAccuracy ? GPS_CONFIG.HIGH_ACCURACY_TIMEOUT : GPS_CONFIG.LOW_ACCURACY_TIMEOUT,
            maximumAge: highAccuracy ? GPS_CONFIG.MAX_AGE_HIGH : GPS_CONFIG.MAX_AGE_LOW
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

                watchIdRef.current = navigator.geolocation.watchPosition(
                    handlePosition,
                    onError,
                    options
                );
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

                            watchIdRef.current = navigator.geolocation.watchPosition(
                                handlePosition,
                                onError,
                                { enableHighAccuracy: false, timeout: GPS_CONFIG.LOW_ACCURACY_TIMEOUT, maximumAge: GPS_CONFIG.MAX_AGE_LOW }
                            );
                        },
                        onError,
                        { enableHighAccuracy: false, timeout: GPS_CONFIG.LOW_ACCURACY_TIMEOUT, maximumAge: GPS_CONFIG.MAX_AGE_LOW }
                    );
                } else {
                    onError(error);
                }
            },
            { enableHighAccuracy: true, timeout: GPS_CONFIG.HIGH_ACCURACY_TIMEOUT, maximumAge: 0 }
        );
    }, [handlePosition, onError]);

    const stopTracking = useCallback(() => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
        setGpsDebug(prev => ({ ...prev, status: 'Stopped', speed: 0 }));
        lastPositionRef.current = null;
        positionHistoryRef.current = [];
        isFirstPositionRef.current = true;
        positionCountRef.current = 0;
    }, []);

    return { gpsDebug, startTracking, stopTracking };
};

// ==========================================
// COMPONENTS
// ==========================================

// Speedometer Component
const Speedometer = React.memo(({ speed }) => {
    const maxSpeed = 120;
    const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
    const rotation = 225 + (clampedSpeed / maxSpeed) * 270;

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

                {Array.from({ length: 9 }, (_, i) => (
                    <circle key={i} cx="150" cy="150" r={15 + i * 8} fill="none"
                        stroke="rgba(66, 230, 207, 0.07)" strokeWidth="1.5" />
                ))}

                <path d="M 72.22 227.78 A 110 110 0 1 1 227.78 227.78"
                    fill="none" stroke="url(#speedGradient)"
                    strokeWidth="14" strokeLinecap="round" />

                {[0, 30, 60, 90, 120].map((s, i) => {
                    const positions = [
                        { x: 55, y: 245 },
                        { x: 30, y: 100 },
                        { x: 150, y: 15 },
                        { x: 270, y: 100 },
                        { x: 245, y: 245 }
                    ];
                    return (
                        <text key={s} x={positions[i].x} y={positions[i].y}
                            fill="#b5c0c9" fontSize="24" fontWeight="400"
                            textAnchor="middle" dominantBaseline="middle"
                            style={{ fontFamily: "'Caveat', 'Kalam', cursive" }}>
                            {s}
                        </text>
                    );
                })}

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
}, (prev, next) => Math.abs(prev.speed - next.speed) < 0.5);

// Stat Box Component
const StatBox = React.memo(({ label, value, unit, className = '' }) => (
    <div className={`stat-box ${className}`}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">
            {value}
            {unit && <span className="stat-unit">{unit}</span>}
        </div>
    </div>
));

// Modal Component
const Modal = ({ title, children, onClose }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{title}</h2>
            {children}
        </div>
    </div>
);

// Input Field Component
const InputField = React.memo(({
    label,
    type = 'number',
    value,
    onChange,
    placeholder,
    id,
    step = '0.01',
    min = '0',
    autoFocus = false,
    inputMode = 'decimal',
    style = {}
}) => (
    <div className="input-group">
        <label htmlFor={id}>{label}</label>
        <input
            type={type}
            id={id}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            step={step}
            min={min}
            autoFocus={autoFocus}
            inputMode={inputMode}
            style={style}
        />
    </div>
));

// Trip Status Component
const TripStatus = React.memo(({ currentKm, totalKm, isActive }) => (
    <div className="trip-status-grid">
        <div className={`trip-status-compact ${isActive ? 'tracking' : ''}`}>
            <div className="trip-label-small">CURRENT TRIP</div>
            <div className="trip-value-small">{currentKm} km</div>
        </div>
        <div className="trip-status-compact">
            <div className="trip-label-small">TOTAL</div>
            <div className="trip-value-small">{totalKm} km</div>
        </div>
    </div>
));

// GPS Status Component
const GPSStatus = React.memo(({ gpsDebug, isActive }) => (
    <div style={{
        background: isActive ? 'linear-gradient(135deg, #1a4d6d 0%, #0f3460 100%)' : '#0f3460',
        padding: '12px',
        borderRadius: '10px',
        marginBottom: '15px',
        border: `2px solid ${isActive ? '#4ecca3' : '#1a4d6d'}`,
        fontSize: '12px'
    }}>
        <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
            📡 {gpsDebug.status}
        </div>
        {isActive && (
            <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5' }}>
                Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span> |
                Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                    {gpsDebug.accuracy.toFixed(0)}m
                </span>
            </div>
        )}
    </div>
));

// Cost Breakdown Component
const CostBreakdown = React.memo(({ petrolEntries, mileageData, totalKm, currentTripKm }) => {
    if (!petrolEntries.length) {
        return (
            <div className="card cost-panel-card">
                <h2>💰 Fuel Expense (Current Fill)</h2>
                <div className="empty-state-compact">
                    <p style={{ color: '#93dac4', fontSize: '13px', margin: 0 }}>
                        💡 Add a petrol fill entry in the <strong>Fuel</strong> tab!
                    </p>
                </div>
            </div>
        );
    }

    const lastEntry = petrolEntries[0];
    const costPerKm = mileageData.mileage > 0 ? lastEntry.pricePerLitre / mileageData.mileage : 0;
    const tankCostIncurred = costPerKm * totalKm;
    const tripCostIncurred = costPerKm * currentTripKm;
    const totalTankCost = lastEntry.totalCost;
    const remainingFuelValue = Math.max(0, totalTankCost - tankCostIncurred);

    return (
        <div className="card cost-panel-card">
            <h2>💰 Fuel Expense (Current Fill)</h2>
            {mileageData.isEstimated && (
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
                    ℹ️ Using 5-fill average ({mileageData.mileage.toFixed(2)} km/L) - last tank was short
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
                    <div className="cost-subtext">{currentTripKm.toFixed(1)} km trip</div>
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
        </div>
    );
});

// History Item Component
const HistoryItem = React.memo(({ entry, type = 'fuel' }) => {
    const { date: formattedDate, time } = formatDate(entry.date || entry.createdAt, true);

    if (type === 'fuel') {
        return (
            <div className="history-item">
                <div className="history-header">
                    <div className="history-date">{formattedDate}</div>
                    <div className="history-mileage">
                        {entry.mileage > 0 ? entry.mileage : 'N/A'} km/L
                        {entry.isEstimated && <span className="estimation-badge">EST</span>}
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
                            <span style={{ fontSize: '10px', color: '#f4a261', marginLeft: '4px' }}>⚠️</span>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (type === 'ride') {
        return (
            <div className="history-item" style={{ borderLeft: `4px solid ${entry.profit > 0 ? '#4ecca3' : '#ee6c4d'}` }}>
                <div className="history-header">
                    <div className="history-date">{formattedDate} • {time}</div>
                    <div className="history-mileage" style={{
                        color: entry.profit > 0 ? '#4ecca3' : '#ee6c4d',
                        fontWeight: 'bold',
                        background: entry.profit > 0 ? 'rgba(78, 204, 163, 0.2)' : 'rgba(238, 108, 77, 0.2)',
                        border: `1px solid ${entry.profit > 0 ? '#4ecca3' : '#ee6c4d'}`
                    }}>
                        Rs. {entry.profit.toFixed(2)}
                    </div>
                </div>
                <div className="history-details">
                    <div className="history-detail">Distance: <span>{entry.km.toFixed(1)} km</span></div>
                    <div className="history-detail">Fare: <span style={{ color: '#4ecca3' }}>Rs. {entry.earnings.toFixed(0)}</span></div>
                    {entry.tip > 0 && (
                        <div className="history-detail">Tip: <span style={{ color: '#f4a261' }}>Rs. {entry.tip.toFixed(0)} 🎁</span></div>
                    )}
                    <div className="history-detail">Total: <span style={{ color: '#4ecca3' }}>Rs. {entry.totalEarnings.toFixed(0)}</span></div>
                    <div className="history-detail">Fuel: <span>{entry.fuelUsed.toFixed(2)} L</span></div>
                    <div className="history-detail">Cost: <span style={{ color: '#ee6c4d' }}>Rs. {entry.fuelCost.toFixed(2)}</span></div>
                </div>
                <div style={{
                    marginTop: '8px',
                    padding: '8px',
                    background: 'rgba(66, 230, 207, 0.1)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#93dac4'
                }}>
                    💰 Profit/km: Rs. {entry.profitPerKm.toFixed(2)} | Cost/km: Rs. {entry.costPerKm.toFixed(2)}
                    {entry.mileageSource === 'rolling-average' && (
                        <span className="estimation-badge" style={{ marginLeft: '6px' }}>5-AVG</span>
                    )}
                </div>
            </div>
        );
    }

    return null;
});

// ==========================================
// MAIN APP COMPONENT
// ==========================================
function App() {
    // State Management
    const [activeScreen, setActiveScreen] = useState('dashboard');
    const [petrolEntries, setPetrolEntries] = useState([]);
    const [trips, setTrips] = useState([]);
    const [rideEntries, setRideEntries] = useState([]);
    const [totalKmSinceLastFill, setTotalKmSinceLastFill] = useState(0);
    const [currentTrip, setCurrentTrip] = useState(null);
    const [isTracking, setIsTracking] = useState(false);
    const [smoothSpeed, setSmoothSpeed] = useState(0);

    // Form States
    const [litres, setLitres] = useState('');
    const [pricePerLitre, setPricePerLitre] = useState('');
    const [fillDate, setFillDate] = useState('');

    const [manualKm, setManualKm] = useState('');
    const [rideKm, setRideKm] = useState('');
    const [rideEarnings, setRideEarnings] = useState('');
    const [rideTip, setRideTip] = useState('');

    const [calcKm, setCalcKm] = useState('');
    const [calcOffer, setCalcOffer] = useState('');
    const [calcMyPrice, setCalcMyPrice] = useState('');
    const [calculationResult, setCalculationResult] = useState(null);

    // Modal States
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showRideEntry, setShowRideEntry] = useState(false);
    const [showRideCompletionDialog, setShowRideCompletionDialog] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);

    // Other States
    const [gpsMessage, setGpsMessage] = useState('');
    const [showGpsAlert, setShowGpsAlert] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [canInstall, setCanInstall] = useState(false);
    const [completedRideKm, setCompletedRideKm] = useState(0);

    // Refs
    const isInitialMount = useRef(true);

    // Custom Hooks
    const mileageCalcs = useMileageCalculations();

    const showGpsMessage = useCallback((message, isError = false) => {
        setGpsMessage(message);
        setShowGpsAlert(true);
        if (!isError) {
            setTimeout(() => setShowGpsAlert(false), 3000);
        }
    }, []);

    const handleGPSError = useCallback((error) => {
        console.error('GPS Error:', error);
        const messages = {
            1: '❌ GPS Permission Denied\n\nGo to Settings → Site Settings → Location',
            2: '📡 No GPS Signal\n\n• Move outdoors\n• Check if Location is ON\n• Restart device',
            3: '⏱️ GPS Timeout - Retrying...'
        };
        const message = messages[error.code] || '⚠️ GPS Error: ' + error.message;
        showGpsMessage(message, error.code !== 3);
    }, [showGpsMessage]);

    const { gpsDebug, startTracking, stopTracking } = useGPSTracking(
        useCallback((distance) => {
            setCurrentTrip(prev => prev ? { ...prev, distance: prev.distance + distance } : null);
            setTotalKmSinceLastFill(prev => prev + distance);
        }, []),
        handleGPSError
    );

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
                    alert('⚠️ Storage full! Trimmed old data');
                }
                console.error('Storage error:', error);
            }
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [petrolEntries, trips, currentTrip, totalKmSinceLastFill, rideEntries]);

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

        let frameId;
        const animate = () => {
            setSmoothSpeed(prev => {
                const target = gpsDebug.speed * 3.6;
                const diff = target - prev;
                return Math.abs(diff) < 0.05 ? target : prev + diff * 0.06;
            });
            frameId = requestAnimationFrame(animate);
        };
        animate();
        return () => cancelAnimationFrame(frameId);
    }, [gpsDebug.speed, isTracking]);

    // ==========================================
    // PWA INSTALL
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
    // PREVENT BACK DURING TRACKING
    // ==========================================
    useEffect(() => {
        const handleBackButton = (e) => {
            if (isTracking) {
                const confirmStop = window.confirm('⚠️ Trip is running!\n\nStop trip and go back?');
                if (confirmStop) {
                    handleTripStop();
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
    }, [isTracking]);

    // ==========================================
    // HANDLERS
    // ==========================================
    const savePetrolEntry = useCallback(() => {
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

        const roundedLitres = roundTo2(litresNum);
        const roundedPrice = roundTo2(priceNum);

        const tankMileage = totalKmSinceLastFill > 0
            ? roundTo2(totalKmSinceLastFill / roundedLitres)
            : 0;

        const isShortTank = totalKmSinceLastFill < MILEAGE_CONFIG.MIN_DISTANCE_THRESHOLD && totalKmSinceLastFill > 0;

        const entry = {
            id: Date.now(),
            litres: roundedLitres,
            pricePerLitre: roundedPrice,
            totalCost: roundTo2(roundedLitres * roundedPrice),
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
            const rollingAvg = mileageCalcs.calculateRollingAverage([entry, ...petrolEntries]);
            alert(`⚠️ Short tank detected (${totalKmSinceLastFill.toFixed(1)} km)\n\n` +
                `Tank mileage: ${tankMileage} km/L (estimated)\n` +
                (rollingAvg > 0 ? `Using 5-fill average (${rollingAvg.toFixed(2)} km/L) for calculations.\n\n` : '\n') +
                `✅ Entry saved!`);
        } else {
            alert('✅ Petrol entry saved!');
        }

        setActiveScreen('dashboard');
    }, [litres, pricePerLitre, fillDate, totalKmSinceLastFill, petrolEntries, mileageCalcs]);

    const saveManualKm = useCallback(() => {
        const kmNum = parseFloat(manualKm);

        if (isNaN(kmNum) || !isFinite(kmNum) || kmNum <= 0) {
            alert('❌ Please enter valid kilometers!');
            return;
        }

        if (kmNum > 1000) {
            const confirmed = window.confirm('⚠️ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
            if (!confirmed) return;
        }

        const roundedKm = roundTo2(kmNum);
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
    }, [manualKm]);

    const saveRideEntry = useCallback(() => {
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

        const roundedKm = roundTo2(kmNum);
        const roundedEarnings = roundTo2(earningsNum);
        const roundedTip = roundTo2(tipNum);

        const effectiveMileageData = mileageCalcs.getEffectiveMileage(petrolEntries);
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
    }, [rideKm, rideEarnings, rideTip, petrolEntries, mileageCalcs]);

    const calculateFare = useCallback(() => {
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

        const effectiveMileageData = mileageCalcs.getEffectiveMileage(petrolEntries);
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
    }, [calcKm, calcOffer, calcMyPrice, petrolEntries, mileageCalcs]);

    const handleTripStart = useCallback((isRide = false) => {
        if (!navigator.geolocation) {
            alert('❌ GPS not supported');
            return;
        }

        const newTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            distance: 0,
            isActive: true,
            isRide
        };

        setCurrentTrip(newTrip);
        setIsTracking(true);
        startTracking(true);

        const tripType = isRide ? '🚖 Ride' : '🏍️ Personal';
        showGpsMessage('🟢 GPS Active (' + tripType + ' - High Accuracy)', false);
    }, [startTracking, showGpsMessage]);

    const handleTripStop = useCallback(() => {
        stopTracking();

        if (currentTrip) {
            const actualKm = currentTrip.distance;

            if (currentTrip.isRide) {
                setCompletedRideKm(actualKm);
                setShowRideCompletionDialog(true);
            } else {
                const completedTrip = {
                    ...currentTrip,
                    endTime: new Date().toISOString(),
                    isActive: false
                };

                setTrips(prev => [...prev, completedTrip]);
                setCurrentTrip(null);
                showGpsMessage('⏸️ Personal Trip Stopped', false);
            }
        }

        setIsTracking(false);
    }, [currentTrip, stopTracking, showGpsMessage]);

    const completeRideWithEarnings = useCallback(() => {
        const earningsNum = parseFloat(rideEarnings);
        const tipNum = parseFloat(rideTip) || 0;

        if (isNaN(earningsNum) || !isFinite(earningsNum) || earningsNum < 0) {
            alert('❌ Please enter valid earnings!');
            return;
        }

        const roundedEarnings = roundTo2(earningsNum);
        const roundedTip = roundTo2(tipNum);
        const actualKm = completedRideKm;

        const effectiveMileageData = mileageCalcs.getEffectiveMileage(petrolEntries);
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
    }, [rideEarnings, rideTip, completedRideKm, currentTrip, petrolEntries, mileageCalcs]);

    const exportData = useCallback(() => {
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
    }, [petrolEntries, trips, rideEntries, totalKmSinceLastFill]);

    // ==========================================
    // SUMMARY CALCULATIONS
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
    // RENDER FUNCTIONS
    // ==========================================
    const renderDashboard = () => {
        const monthly = getMonthlySummary;
        const lastEntry = petrolEntries[0];
        const effectiveMileageData = mileageCalcs.getEffectiveMileage(petrolEntries);
        const rollingAvg = mileageCalcs.calculateRollingAverage(petrolEntries);

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
                                <StatBox label="Litres" value={lastEntry.litres} unit="L" />
                                <StatBox label="Distance" value={totalKmSinceLastFill.toFixed(2)} unit="km" />
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
                        <StatBox label="Litres" value={monthly.totalLitres.toFixed(1)} unit="L" />
                        <StatBox label="Spent" value={`Rs. ${monthly.totalSpent.toFixed(0)}`} />
                        <StatBox label="Distance" value={monthly.totalKm.toFixed(0)} unit="km" />
                        <StatBox label="Avg Mileage" value={monthly.avgMileage} unit="km/L" />
                    </div>
                </div>

                {petrolEntries.length > 0 && (
                    <div className="card">
                        <h2>⚙️ Settings</h2>
                        <button className="btn btn-secondary" onClick={exportData} style={{ marginBottom: '10px' }}>
                            📥 Export Data (JSON)
                        </button>
                        <button className="btn btn-danger" onClick={() => setShowResetConfirm(true)}>
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

    const renderPetrolEntry = () => (
        <div className="card">
            <h2>⛽ Add Petrol</h2>
            <InputField
                label="Litres Filled"
                id="litres"
                placeholder="Enter litres"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
            />
            <InputField
                label="Price per Litre (Rs.)"
                id="pricePerLitre"
                placeholder="Enter price"
                value={pricePerLitre}
                onChange={(e) => setPricePerLitre(e.target.value)}
            />
            <InputField
                label="Date"
                id="fillDate"
                type="date"
                value={fillDate}
                onChange={(e) => setFillDate(e.target.value)}
            />
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

    const renderPersonalTrip = () => {
        const currentTripKm = currentTrip && currentTrip.isActive && !currentTrip.isRide
            ? currentTrip.distance.toFixed(2)
            : '0.00';

        const isPersonalTripActive = isTracking && currentTrip && !currentTrip.isRide;
        const effectiveMileageData = mileageCalcs.getEffectiveMileage(petrolEntries);
        const currentTripDistanceVal = currentTrip && currentTrip.isActive && !currentTrip.isRide ? currentTrip.distance : 0;

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

                    <GPSStatus gpsDebug={gpsDebug} isActive={isPersonalTripActive} />

                    {isPersonalTripActive && gpsDebug.accuracy > GPS_CONFIG.POOR_ACCURACY_THRESHOLD && (
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

                    <TripStatus
                        currentKm={currentTripKm}
                        totalKm={totalKmSinceLastFill.toFixed(2)}
                        isActive={isPersonalTripActive}
                    />

                    {!isPersonalTripActive ? (
                        <>
                            <button className="btn btn-success btn-lg btn-personal-trip" onClick={() => handleTripStart(false)}>
                                ▶️ START PERSONAL TRIP
                            </button>
                            <button className="btn btn-secondary btn-lg" style={{ marginTop: '10px' }}
                                onClick={() => setShowManualEntry(true)}>
                                ✏️ ADD MANUAL KM
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-danger btn-lg" onClick={handleTripStop}>
                            ⏹️ STOP TRIP
                        </button>
                    )}

                    {showGpsAlert && (
                        <div className="alert alert-warning" style={{ marginTop: '15px' }}>
                            {gpsMessage}
                        </div>
                    )}
                </div>

                <CostBreakdown
                    petrolEntries={petrolEntries}
                    mileageData={effectiveMileageData}
                    totalKm={totalKmSinceLastFill}
                    currentTripKm={currentTripDistanceVal}
                />
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

                    <GPSStatus gpsDebug={gpsDebug} isActive={isRideTripActive} />

                    {isRideTripActive && gpsDebug.accuracy > GPS_CONFIG.POOR_ACCURACY_THRESHOLD && (
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

                    <TripStatus
                        currentKm={currentRideTripKm}
                        totalKm={totalKmSinceLastFill.toFixed(2)}
                        isActive={isRideTripActive}
                    />

                    {!isRideTripActive ? (
                        <>
                            <button className="btn btn-primary btn-lg btn-ride-trip"
                                onClick={() => handleTripStart(true)}>
                                ▶️ START RIDE TRIP
                                <div className="btn-subtitle">GPS tracking + earnings</div>
                            </button>
                            <button className="btn btn-secondary btn-lg" style={{ marginTop: '10px' }}
                                onClick={() => setShowRideEntry(true)}>
                                ✏️ ADD RIDE MANUALLY
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-danger btn-lg" onClick={handleTripStop}>
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
                            <StatBox label="Total Rides" value={rideSummary.totalRides} />
                            <StatBox label="Distance" value={rideSummary.totalRideKm.toFixed(0)} unit="km" />
                            <StatBox label="Earnings" value={`Rs. ${rideSummary.totalEarnings.toFixed(0)}`} />
                            <StatBox label="Tips 🎁" value={`Rs. ${rideSummary.totalTips.toFixed(0)}`} />
                            <StatBox label="Fuel Cost" value={`Rs. ${rideSummary.totalFuelCost.toFixed(0)}`} />
                            <StatBox label="Avg Profit/Ride" value={`Rs. ${rideSummary.avgProfitPerRide.toFixed(0)}`} />
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
                            {rideEntries.slice(0, 10).map(ride => (
                                <HistoryItem key={ride.id} entry={ride} type="ride" />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderCalculator = () => (
        <div>
            <div className="card">
                <h2>🧮 Fare Calculator</h2>
                <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                    Compare offers and negotiate better rates!
                </p>

                <InputField
                    label="Distance (km)"
                    id="calcKm"
                    placeholder="e.g., 20"
                    value={calcKm}
                    onChange={(e) => setCalcKm(e.target.value)}
                    step="0.1"
                    style={{ fontSize: '16px', padding: '12px' }}
                />

                <InputField
                    label="Customer Offer (Rs.)"
                    id="calcOffer"
                    placeholder="e.g., 350"
                    value={calcOffer}
                    onChange={(e) => setCalcOffer(e.target.value)}
                    step="1"
                    style={{ fontSize: '16px', padding: '12px' }}
                />

                <InputField
                    label="Your Counter Offer (Rs.) - Optional"
                    id="calcMyPrice"
                    placeholder="e.g., 400"
                    value={calcMyPrice}
                    onChange={(e) => setCalcMyPrice(e.target.value)}
                    step="1"
                    style={{ fontSize: '16px', padding: '12px' }}
                />

                {petrolEntries.length === 0 && (
                    <div className="modal-warning">
                        ⚠️ Add fuel data first for accurate calculations
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-success btn-calculator" onClick={calculateFare} style={{ flex: 1 }}>
                        🧮 Calculate
                    </button>
                    <button className="btn btn-secondary" onClick={() => {
                        setCalcKm('');
                        setCalcOffer('');
                        setCalcMyPrice('');
                        setCalculationResult(null);
                    }} style={{ flex: 1 }}>
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

    const renderHistory = () => {
        const rollingAvg = mileageCalcs.calculateRollingAverage(petrolEntries);
        const allTimeAvg = MILEAGE_CONFIG.ENABLE_ALL_TIME_AVG
            ? mileageCalcs.calculateAllTimeAverage(petrolEntries)
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
                            {petrolEntries.map(entry => (
                                <HistoryItem key={entry.id} entry={entry} type="fuel" />
                            ))}
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
            {/* Modals */}
            {showRideCompletionDialog && (
                <Modal title="🚖 Complete Ride" onClose={() => setShowRideCompletionDialog(false)}>
                    <div className="ride-completion-distance">
                        <div className="ride-completion-label">Distance Covered</div>
                        <div className="ride-completion-value">{completedRideKm.toFixed(2)} km</div>
                    </div>
                    <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>
                        Enter your ride earnings
                    </p>
                    <InputField
                        label="Base Fare (Rs.)"
                        id="rideEarnings"
                        placeholder="e.g., 300"
                        value={rideEarnings}
                        onChange={(e) => setRideEarnings(e.target.value)}
                        step="1"
                        autoFocus
                        style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                    />
                    <div className="input-group tip-input-wrapper">
                        <InputField
                            label="Tip (Optional) 🎁"
                            id="rideTip"
                            placeholder="e.g., 50"
                            value={rideTip}
                            onChange={(e) => setRideTip(e.target.value)}
                            step="1"
                            style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                        />
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
                        <button className="btn btn-secondary" onClick={() => {
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
                        }}>
                            Skip
                        </button>
                    </div>
                </Modal>
            )}

            {showRideEntry && (
                <Modal title="🚖 Add Ride Manually" onClose={() => setShowRideEntry(false)}>
                    <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                        Manual entry (without GPS tracking)
                    </p>
                    <InputField
                        label="Distance (km)"
                        id="rideKm"
                        placeholder="e.g., 15"
                        value={rideKm}
                        onChange={(e) => setRideKm(e.target.value)}
                        step="0.1"
                        autoFocus
                        style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                    />
                    <InputField
                        label="Base Fare (Rs.)"
                        id="rideEarnings"
                        placeholder="e.g., 300"
                        value={rideEarnings}
                        onChange={(e) => setRideEarnings(e.target.value)}
                        step="1"
                        style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                    />
                    <div className="input-group tip-input-wrapper">
                        <InputField
                            label="Tip (Optional) 🎁"
                            id="rideTip"
                            placeholder="e.g., 50"
                            value={rideTip}
                            onChange={(e) => setRideTip(e.target.value)}
                            step="1"
                            style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                        />
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
                        <button className="btn btn-secondary" onClick={() => setShowRideEntry(false)}>
                            Cancel
                        </button>
                    </div>
                </Modal>
            )}

            {showManualEntry && (
                <Modal title="✏️ Add Manual KM" onClose={() => setShowManualEntry(false)}>
                    <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                        Enter distance when someone else rode
                    </p>
                    <InputField
                        label="Kilometers"
                        id="manualKm"
                        placeholder="Enter km"
                        value={manualKm}
                        onChange={(e) => setManualKm(e.target.value)}
                        step="0.1"
                        autoFocus
                        style={{ fontSize: '18px', padding: '15px', textAlign: 'center' }}
                    />
                    <div className="modal-buttons">
                        <button className="btn btn-success" onClick={saveManualKm}>
                            ✅ Add KM
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowManualEntry(false)}>
                            Cancel
                        </button>
                    </div>
                </Modal>
            )}

            {showResetConfirm && (
                <Modal title="⚠️ Confirm Reset" onClose={() => setShowResetConfirm(false)}>
                    <p>Delete all data?</p>
                    <p style={{ color: '#ee6c4d', fontSize: '14px', marginTop: '10px' }}>
                        Cannot be undone!
                    </p>
                    <div className="modal-buttons">
                        <button className="btn btn-danger" onClick={() => {
                            stopTracking();
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
                            localStorage.removeItem('petrolTrackerData');
                            setShowResetConfirm(false);
                            setActiveScreen('dashboard');
                            alert('✅ All data reset!');
                        }}>
                            Yes, Delete
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowResetConfirm(false)}>
                            Cancel
                        </button>
                    </div>
                </Modal>
            )}

            {/* Header */}
            <div className="header">
                <h1>⛽ Petrol Tracker</h1>
                <p>Track fuel efficiency</p>
            </div>

            {/* Main Content */}
            <div className="container">
                {activeScreen === 'dashboard' && renderDashboard()}
                {activeScreen === 'fuel' && renderPetrolEntry()}
                {activeScreen === 'personal' && renderPersonalTrip()}
                {activeScreen === 'ride' && renderRideTrip()}
                {activeScreen === 'calculator' && renderCalculator()}
                {activeScreen === 'history' && renderHistory()}
            </div>

            {/* Bottom Navigation */}
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