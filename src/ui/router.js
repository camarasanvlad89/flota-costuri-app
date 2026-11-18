import { useState, useEffect } from './dom.js';
import { parseHash, matchRoute, buildPath } from './route-match.js';

export { parseHash, matchRoute, buildPath };

export function currentLocation() {
  return parseHash(typeof location !== 'undefined' ? location.hash : '#/acasa');
}
export function navigate(path) {
  if (typeof location === 'undefined') return;
  const target = path.startsWith('#') ? path : '#' + path;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}
export function useLocation() {
  const [loc, setLoc] = useState(currentLocation);
  useEffect(() => {
    const on = () => setLoc(currentLocation());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return loc;
}
