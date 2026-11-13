import {FLEET} from './fleet.js';
import { AIRFRAME_LIMITS } from './flight-service.js';

// Original mass and rotor dimensions use 40REF, climb and load use HELI.TWK.
// Extra airframes use the game-specific mass and load profiles in fleet.js.
const poundsToKg = 0.45359237;
const personKg = 80;
const gravity = 9.80665;
const airframes = new Map();
for (const {id, emptyKg, diameter, climb, usefulLb:maxLoad} of FLEET) {
  const fuelKgPerGal = (id === 'SCWZR300' || id === 'GARAM' ? 6.01 : 6.68) * poundsToKg;
  const nominalKg = emptyKg + personKg + AIRFRAME_LIMITS[id].gallons * fuelKgPerGal;
  // Max Load has no declared SI unit. This reconstruction uses pounds of
  // useful load and sizes the bucket to half that allowance, including water.
  const usefulKg = maxLoad * poundsToKg;
  const referenceWeight = (emptyKg + usefulKg) * gravity;
  // Tandem rotors sweep two disk areas. Coaxial rotors share the same disk.
  const diskArea = Math.PI * (diameter / 2) ** 2 * (id === 'DUSOL' ? 2 : 1);
  const hoverInflow = Math.sqrt(referenceWeight / (2 * 1.225 * diskArea));
  const idealPower = referenceWeight * (climb / 2 + Math.hypot(climb / 2, hoverInflow));
  const ratedThrust = Math.cbrt(idealPower ** 2 * 2 * 1.225 * diskArea);
  airframes.set(id, {emptyKg, fuelKgPerGal, nominalKg, ratedThrust, usefulKg});
}

const bound = (value, max) => Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));

// Available vertical thrust at full collective and current rotor speed.
// Hover consumes only the thrust needed to balance the aircraft's weight.
export function getRotorPerformance(id, {
  fuelGallons = AIRFRAME_LIMITS[id].gallons, passengers = 0, waterFraction = 0,
  externalLoadKg = 0, rpm = 1, damage = 0, pilotOnBoard = true, verticalFactor = 1,
  waterCapacityLitres = null, climbFactor = 1,
} = {}) {
  const a = airframes.get(id);
  const waterKg = bound(waterFraction, 1) * (waterCapacityLitres ?? a.usefulKg * 0.5);
  const payloadKg = bound(passengers, 100) * personKg + waterKg + bound(externalLoadKg, Infinity);
  const massKg = a.emptyKg + (pilotOnBoard ? personKg : 0) + payloadKg
    + bound(fuelGallons, AIRFRAME_LIMITS[id].gallons) * a.fuelKgPerGal;
  const weightNewtons = massKg * gravity;
  const health = 1 - bound(damage, 100) / 100;
  const reserveThrust = a.ratedThrust - a.nominalKg * gravity;
  const maxThrustToWeight = (a.ratedThrust + reserveThrust * (climbFactor - 1)) * health / weightNewtons;
  const thrustToWeight = maxThrustToWeight * bound(rpm, 1) ** 2;
  const verticalThrustToWeight = thrustToWeight * bound(verticalFactor, 1);
  const nominalMargin = a.ratedThrust / (a.nominalKg * gravity) - 1;
  const climbScale = Math.max(0, (verticalThrustToWeight - 1) / nominalMargin);
  return {massKg, payloadKg, waterKg, weightNewtons, thrustNewtons: weightNewtons * thrustToWeight,
    thrustToWeight, verticalThrustToWeight, maxThrustToWeight, hoverRpm: maxThrustToWeight > 0 ? 1 / Math.sqrt(maxThrustToWeight) : Infinity,
    climbScale};
}
