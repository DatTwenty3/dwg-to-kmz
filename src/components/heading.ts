'use client';
// Compass heading of the phone (degrees clockwise from true/magnetic north), for the direction cone of the
// live-position dot. iOS: `webkitCompassHeading`, after `DeviceOrientationEvent.requestPermission()` — which
// must be called from a user gesture (the geolocate button press). Android Chrome: `deviceorientationabsolute`
// (alpha is counter-clockwise from north). Both are corrected for the screen orientation.

type IosOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IosPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

const screenAngle = () => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0) || 0;

/** Starts listening; `onHeading` gets 0–360°. Returns a stop function. Does nothing where unsupported. */
export function startHeading(onHeading: (deg: number) => void, onDenied?: () => void): () => void {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return () => {};
  let stopped = false;
  let detach = () => {};

  const ios = (e: Event) => {
    const h = (e as IosOrientationEvent).webkitCompassHeading;
    if (typeof h === 'number' && Number.isFinite(h)) onHeading((h + screenAngle()) % 360);
  };
  const absolute = (e: Event) => {
    const { alpha } = e as DeviceOrientationEvent;
    if (typeof alpha === 'number' && Number.isFinite(alpha)) onHeading((360 - alpha + screenAngle()) % 360);
  };

  const attach = () => {
    if (stopped) return;
    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    if (hasAbsolute) {
      window.addEventListener('deviceorientationabsolute', absolute);
      detach = () => window.removeEventListener('deviceorientationabsolute', absolute);
    } else {
      // iOS (webkitCompassHeading) — other browsers without absolute orientation give no heading here.
      window.addEventListener('deviceorientation', ios);
      detach = () => window.removeEventListener('deviceorientation', ios);
    }
  };

  const req = (DeviceOrientationEvent as unknown as IosPermission).requestPermission;
  if (typeof req === 'function') {
    req()
      .then((r) => (r === 'granted' ? attach() : onDenied?.()))
      .catch(() => onDenied?.());
  } else attach();

  return () => {
    stopped = true;
    detach();
  };
}

/** The direction cone: a soft blue wedge pointing up from the centre (rotated by the marker). */
export function headingConeElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ui-heading-cone';
  el.innerHTML =
    '<svg width="110" height="110" viewBox="0 0 110 110" aria-hidden="true">' +
    '<defs><radialGradient id="ui-cone-g" cx="55" cy="55" r="55" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0.1" stop-color="#2563eb" stop-opacity="0.55"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/>' +
    '</radialGradient></defs>' +
    // ±35° wedge from the centre upwards.
    '<path d="M55 55 L23.5 10 A55 55 0 0 1 86.5 10 Z" fill="url(#ui-cone-g)"/></svg>';
  return el;
}
