const FUTO_CAMPUS = {
  latitude: 5.3844,
  longitude: 7.0365
};
const FUTO_RADIUS_METERS = 5000;
const MAX_LOCATION_ACCURACY_METERS = 1000;
const EARTH_RADIUS_METERS = 6371000;

function distanceInMeters(first, second) {
  const toRadians = degrees => degrees * (Math.PI / 180);
  const latitudeDifference = toRadians(second.latitude - first.latitude);
  const longitudeDifference = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
    Math.sin(longitudeDifference / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function validateFutoLocation(location) {
  if (
    !location ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    !Number.isFinite(location.accuracy) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180 ||
    location.accuracy <= 0 ||
    location.accuracy > MAX_LOCATION_ACCURACY_METERS
  ) {
    return { valid: false, withinCampus: false };
  }

  return {
    valid: true,
    withinCampus: distanceInMeters(location, FUTO_CAMPUS) <= FUTO_RADIUS_METERS
  };
}

module.exports = { validateFutoLocation };
